"""Chat pipeline. The order below is the safety architecture (G-3):

1. authentication + consent           (ConsentedUser dependency)
2. age band enabled                   (server-side allowlist)
3. context                            (saved thread of the VERIFIED owner, or signed
                                       browser history; forged assistant turns rejected)
4. typed-input gate (topic mode)      (crisis screen -> support; anything not recognised
                                       as one reviewed topic is refused here, before any
                                       limit, retrieval or model call; accepted text is
                                       replaced by its reviewed question)
5. rate limit + daily provider cap    (PostgreSQL; any failure = no generation)
6. safety assessment + decision       (whole window; failures = no generation)
7. approved, age-applicable retrieval (failure = unavailable; none = no_evidence)
8. generation permit                  (single-use, request-bound)
9. provider via generate_with_permit  (receives reviewed questions, public passages and
                                       recent replies only; never the user's typed words)
10. output validation                 (citations must match this request's retrieval)
11. metadata-only safety event        (never message text)
12. opted-in history                  (validated replies only, encrypted, owner-scoped)

There is no other path to the provider.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import hmac
import re
import uuid
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.ai.prompts.age_bands import AGE_BANDS, band_enabled, resolve_age_band
from app.ai.provider.base import (
    PROVIDER_TIMEOUT_SECONDS,
    ChatProvider,
    GenerationRequest,
    Passage,
    ProviderError,
)
from app.common.errors import ApiError
from app.common.ratelimit import allow_request, requests_last_day
from app.conversations import history as history_store
from app.conversations.crypto import HistoryCipher
from app.conversations.demo import DEMO_PROMPTS
from app.conversations.history import StoredTurn
from app.conversations.intents import classify
from app.conversations.models import ChatConversation
from app.conversations.schemas import (
    ChatReply,
    ChatRequest,
    ChatResponse,
    ChatStatus,
    Citation,
    ConversationSummary,
    HistoryTurn,
    RefusalReason,
    StoredMessageOut,
    TopicOut,
)
from app.core.logging import get_logger
from app.knowledge.retrieval import retrieve
from app.safety.assessor import SafetyAssessor, assess_safety_risk
from app.safety.contracts import Outcome, RiskLevel, SafetyDecision
from app.safety.gate import GenerationGate, PermitError, generate_with_permit
from app.safety.models import SafetyEvent
from app.safety.output import validate_output
from app.safety.policy import SafetyPolicy
from app.users.models import User

logger = get_logger(__name__)

NOTICES: dict[str, str] = {
    "support": (
        "[Placeholder, pending clinical review (D-13)] I'm not able to help with this "
        "message here. Support content for situations like this is still being reviewed "
        "by qualified professionals."
    ),
    "out_of_scope": (
        "I can't diagnose conditions or give advice about medication. A qualified health "
        "professional can help with that. I'm happy to talk about general wellbeing."
    ),
    "no_evidence": (
        "I don't have reviewed information about that yet, so I'd rather not guess. "
        "You could try asking about something else."
    ),
    "unable_to_answer": "I couldn't put together a safe answer this time. Please try rephrasing.",
    "unavailable": "The assistant is unavailable right now. Please try again in a few minutes.",
}

_PROVIDER_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="llm")
_ARABIC = re.compile("[؀-ۿ]")
_PROMPTS_BY_ID = {p.prompt_id: p for p in DEMO_PROMPTS}


@dataclass
class ChatRuntime:
    policy: SafetyPolicy
    assessor: SafetyAssessor
    provider: ChatProvider
    signing_key: bytes
    rate_limit_per_minute: int
    gate: GenerationGate = field(default_factory=GenerationGate)
    # Restricted demo (app/conversations/demo.py): approved questions, listed accounts.
    demo_curated: bool = False
    demo_allowed: frozenset[str] = frozenset()
    demo_all_consented_adults: bool = False  # explicit access mode, see Settings
    provider_daily_limit: int = 300
    # Saved history (D-54): the cipher when CHAT_HISTORY_KEYS is configured, else None.
    history: HistoryCipher | None = None
    history_retention_days: int = 90

    @property
    def retrievable_statuses(self) -> tuple[str, ...]:
        # Under the test-only policy: also `draft` (authentic publisher guidance not yet
        # clinically reviewed) and `synthetic` fixtures. Any non-test policy: approved only.
        if self.policy.synthetic:
            return ("approved", "draft", "synthetic")
        if self.policy.curated_only:  # real publisher passages, never synthetic fixtures
            return ("approved", "draft")
        return ("approved",)


def sign_turn(key: bytes, user_id: uuid.UUID, text: str) -> str:
    return hmac.new(key, f"{user_id}\x1f{text}".encode(), hashlib.sha256).hexdigest()


def _signature_valid(key: bytes, user_id: uuid.UUID, text: str, signature: str) -> bool:
    return hmac.compare_digest(sign_turn(key, user_id, text), signature)


def _failure_category(error: BaseException) -> str:
    """A fixed, content-free label for logs: never the message, response body or key."""
    if isinstance(error, ProviderError):
        return f"provider_{error}"  # e.g. provider_http_403, provider_quota, provider_malformed
    if isinstance(error, concurrent.futures.TimeoutError | TimeoutError):
        return "timeout"
    if isinstance(error, PermitError):
        return "permit"
    return f"error_{type(error).__name__}"


def _respond(status: ChatStatus) -> ChatResponse:
    return ChatResponse(status=status, notice=NOTICES.get(status))


def _record(
    session: Session,
    user: User,
    request_id: uuid.UUID,
    band: str,
    decision: SafetyDecision,
    final_status: str,
) -> None:
    session.add(
        SafetyEvent(
            actor_user_id=user.id,
            request_id=request_id,
            age_band=band,
            risk_level=decision.risk_level.value,
            outcome=decision.outcome.value,
            final_status=final_status,
            policy_version=decision.policy_version,
            reason_code=decision.reason_code,
        )
    )


REFUSAL_NOTICES: dict[str, str] = {
    "unsupported_topic": (
        "This version can only answer general questions about a few wellness topics: "
        "stress, grounding, everyday wellbeing habits, difficult thoughts and feelings, "
        "sleep, physical activity and mindfulness. Please ask a short, general question "
        "without personal details, or choose a suggestion."
    ),
    "multiple_topics": "Please ask about one topic at a time.",
    "needs_context": (
        "Ask a question about one of the topics first. Then I can explain it in Egyptian "
        "Arabic, continue, or give a short summary."
    ),
    "too_long": "That message is too long for this version. Please ask a short, general question.",
    "personal_details": (
        "Please remove personal details such as phone numbers, e-mail addresses or links, "
        "and ask a general question."
    ),
    "clinical": (
        "I can't help with diagnoses, medication or physical symptoms. A doctor or another "
        "qualified health professional can. I can share general wellbeing information."
    ),
    "sensitive": (
        "That's outside what this wellness-education assistant covers. If something is "
        "affecting you, a qualified professional or someone you trust can help."
    ),
}
_GATE_REFUSALS: dict[str, RefusalReason] = {
    "unsupported": "unsupported_topic",
    "multiple_topics": "multiple_topics",
    "needs_context": "needs_context",
    "too_long": "too_long",
    "personal_details": "personal_details",
    "clinical": "clinical",
    "sensitive": "sensitive",
}


@dataclass
class _Context:
    """What earlier turns contribute. In topic mode user turns are replaced by their
    reviewed question, so the user's own words never reach retrieval or the model."""

    intents: list[str] = field(default_factory=list)
    search_context: list[str] = field(default_factory=list)
    model_history: list[tuple[str, str]] = field(default_factory=list)
    crisis: bool = False


def _canonical(intent_id: str, language: str) -> str | None:
    prompt = _PROMPTS_BY_ID.get(intent_id)
    if prompt is None:
        return None
    return prompt.ar if language == "ar" else prompt.en


def _ephemeral_context(runtime: ChatRuntime, history: list[HistoryTurn]) -> _Context:
    context = _Context()
    keep_reply = False
    for turn in history:
        if turn.role == "user":
            if not runtime.demo_curated:
                context.search_context.append(turn.text)
                context.model_history.append(("user", turn.text))
                keep_reply = True
                continue
            result = classify(turn.text, context.intents)
            if result.outcome == "crisis":
                context.crisis = True
            keep_reply = result.outcome == "accept"
            if keep_reply and result.prompt is not None:
                context.intents.append(result.prompt.prompt_id)
                context.search_context.append(result.canonical)
                context.model_history.append(("user", result.canonical))
        elif keep_reply:  # signature already verified; replies to dropped turns are dropped
            context.model_history.append(("assistant", turn.text))
    return context


def _stored_context(runtime: ChatRuntime, turns: list[StoredTurn]) -> _Context:
    context = _Context()
    for turn in turns:
        if turn.role == "user":
            canonical = _canonical(turn.intent_id, turn.language) if turn.intent_id else None
            if runtime.demo_curated and canonical is None:
                continue  # never send stored free text to the model in topic mode
            text = canonical or turn.text
            if turn.intent_id:
                context.intents.append(turn.intent_id)
            context.search_context.append(text)
            context.model_history.append(("user", text))
        else:
            context.model_history.append(("assistant", turn.text))
    return context


def _citation_out(raw: dict[str, Any]) -> Citation:
    return Citation.model_validate(raw)


def conversation_summary(
    cipher: HistoryCipher, conversation: ChatConversation
) -> ConversationSummary:
    return ConversationSummary(
        conversation_id=conversation.id,
        title=history_store.conversation_title(cipher, conversation),
        message_count=conversation.message_count,
        created_at=conversation.created_at,
        last_activity_at=conversation.last_activity_at,
    )


def _topic(intent_id: str | None, language: str) -> TopicOut | None:
    question = _canonical(intent_id, language) if intent_id else None
    return TopicOut(prompt_id=intent_id, question=question) if intent_id and question else None


def stored_message_out(runtime: ChatRuntime, user: User, turn: StoredTurn) -> StoredMessageOut:
    return StoredMessageOut(
        message_id=turn.message_id,
        seq=turn.seq,
        role="assistant" if turn.role == "assistant" else "user",
        text=turn.text,
        language="ar" if turn.language == "ar" else "en",
        topic=_topic(turn.intent_id, turn.language) if turn.role == "user" else None,
        citations=[_citation_out(c) for c in turn.citations],
        model=turn.model,
        signature=sign_turn(runtime.signing_key, user.id, turn.text)
        if turn.role == "assistant"
        else None,
        created_at=turn.created_at,
    )


def _saved_response(
    runtime: ChatRuntime,
    user: User,
    conversation: ChatConversation,
    question: StoredTurn,
    answer: StoredTurn,
    topic: TopicOut | None = None,
) -> ChatResponse:
    assert runtime.history is not None  # noqa: S101 - only called with history active
    return ChatResponse(
        status="reply",
        reply=ChatReply(
            text=answer.text,
            signature=sign_turn(runtime.signing_key, user.id, answer.text),
            citations=[_citation_out(c) for c in answer.citations],
            model=answer.model,
        ),
        topic=topic or _topic(question.intent_id, question.language),
        conversation=conversation_summary(runtime.history, conversation),
        user_message_id=question.message_id,
        assistant_message_id=answer.message_id,
        created_at=answer.created_at,
    )


def _refuse(reason: RefusalReason) -> ChatResponse:
    return ChatResponse(
        status="out_of_scope", notice=REFUSAL_NOTICES[reason], refusal_reason=reason
    )


def handle_message(
    session: Session, user: User, runtime: ChatRuntime, payload: ChatRequest
) -> ChatResponse:
    band = resolve_age_band()
    if not band_enabled(band):
        raise ApiError(403, "age_band_unavailable", "This experience isn't available yet.")
    band_config = AGE_BANDS[band]
    cipher = runtime.history
    saving = history_store.history_active(user, cipher)

    # --- Context: from the verified owner's saved thread, or signed browser history ---
    conversation: ChatConversation | None = None
    if payload.conversation_id is not None:
        if cipher is None or not saving:
            raise ApiError(
                409, "history_off", "Saved history is switched off, so this chat can't continue."
            )
        if payload.client_message_id is not None:
            existing = history_store.find_by_client_id(
                session, cipher, user.id, payload.client_message_id
            )
            if existing is not None and existing[0].id == payload.conversation_id:
                return _saved_response(runtime, user, *existing)
        conversation = history_store.get_conversation(
            session, user.id, payload.conversation_id, lock=True
        )
        if conversation is None:  # missing, deleted, or another user's: indistinguishable
            raise ApiError(404, "conversation_not_found", "This conversation doesn't exist.")
        context = _stored_context(
            runtime, history_store.recent_turns(session, cipher, user.id, conversation.id)
        )
    else:
        for turn in payload.history:
            if turn.role == "assistant" and not _signature_valid(
                runtime.signing_key, user.id, turn.text, turn.signature or ""
            ):
                raise ApiError(
                    422, "invalid_history", "The conversation history couldn't be verified."
                )
        if saving and payload.client_message_id is not None and cipher is not None:
            existing = history_store.find_by_client_id(
                session, cipher, user.id, payload.client_message_id
            )
            if existing is not None:
                return _saved_response(runtime, user, *existing)
        context = _ephemeral_context(runtime, payload.history)

    # --- Typed-input gate (topic mode): refused before limits, retrieval or any model ---
    request_id = uuid.uuid4()
    language = "ar" if _ARABIC.search(payload.message) else "en"
    intent_id: str | None = None
    message = payload.message  # assessed and searched
    model_question = payload.message  # what the model is asked
    topic_question: str | None = None
    if runtime.demo_curated:
        gate = classify(payload.message, context.intents)
        if gate.outcome == "crisis" or context.crisis:
            decision = SafetyDecision(
                risk_level=RiskLevel.HIGH,
                outcome=Outcome.SUPPORT,
                policy_version=runtime.policy.policy_id,
                reason_code="prototype_crisis_screen",
            )
            _record(session, user, request_id, band.value, decision, "support")
            return _respond("support")
        if gate.outcome != "accept" or gate.prompt is None:
            logger.info("chat_input_refused", extra={"reason": gate.outcome})
            return _refuse(_GATE_REFUSALS.get(gate.outcome, "unsupported_topic"))
        intent_id, language, message = gate.prompt.prompt_id, gate.language, gate.canonical
        # The model gets a general re-expression of the question (topic + allow-listed
        # context), never the user's own sentence.
        model_question = topic_question = gate.query

    if (
        saving
        and conversation is None
        and cipher is not None
        and history_store.count_conversations(session, user.id) >= history_store.MAX_CONVERSATIONS
    ):
        raise ApiError(
            409,
            "history_full",
            "You've reached the number of saved conversations. Delete some to save more.",
        )

    try:
        with session.begin_nested():  # a limiter error must not poison the request transaction
            permitted = allow_request(session, user.id, runtime.rate_limit_per_minute)
    except Exception:  # limiter unavailable: fail closed
        logger.error("chat_rate_limiter_unavailable")
        return _respond("unavailable")
    if not permitted:
        raise ApiError(
            429, "rate_limited", "Too many messages. Please wait a minute and try again."
        )
    if getattr(runtime.provider, "kind", "scripted") == "model":
        try:
            with session.begin_nested():
                used = requests_last_day(session)
        except Exception:  # cannot tell: fail closed
            logger.error("chat_daily_limit_unavailable")
            return _respond("unavailable")
        if used > runtime.provider_daily_limit:
            logger.warning("chat_daily_limit_reached")
            return _respond("unavailable")

    window = [text for role, text in context.model_history if role == "user"] + [message]
    decision = assess_safety_risk(runtime.assessor, runtime.policy, window, band.value)

    if decision.outcome is not Outcome.GENERATE:
        status: ChatStatus = {
            Outcome.SUPPORT: "support",
            Outcome.OUT_OF_SCOPE: "out_of_scope",
            Outcome.UNAVAILABLE: "unavailable",
        }.get(decision.outcome, "unavailable")  # type: ignore[assignment]
        _record(session, user, request_id, band.value, decision, status)
        return _respond(status)

    try:
        with session.begin_nested():
            chunks = retrieve(
                session,
                message,
                band.value,
                runtime.retrievable_statuses,
                # Follow-ups ("explain that in Arabic") borrow the topic of earlier user
                # turns (their reviewed questions in topic mode); assistant turns are never
                # used as search input, so sources are always freshly retrieved.
                context=context.search_context,
            )
    except Exception as error:
        logger.error("chat_retrieval_unavailable", extra={"category": _failure_category(error)})
        _record(session, user, request_id, band.value, decision, "unavailable")
        return _respond("unavailable")
    if not chunks:
        logger.info("chat_no_evidence")
        _record(session, user, request_id, band.value, decision, "no_evidence")
        return _respond("no_evidence")

    permit = runtime.gate.authorize(decision, str(request_id), model_question)
    generation = GenerationRequest(
        message=model_question,
        history=context.model_history[-history_store.CONTEXT_TURNS * 2 :],
        passages=[Passage(chunk_id=str(c.chunk_id), text=c.content) for c in chunks],
        instructions=band_config.instructions,
        max_chars=band_config.max_reply_chars,
        reply_language=language,
    )
    future = _PROVIDER_EXECUTOR.submit(
        generate_with_permit,
        runtime.gate,
        runtime.provider,
        permit,
        str(request_id),
        model_question,
        generation,
    )
    try:
        result = future.result(timeout=PROVIDER_TIMEOUT_SECONDS)
    except Exception as error:  # timeout, provider error, permit error
        future.cancel()
        logger.error("chat_generation_failed", extra={"category": _failure_category(error)})
        _record(session, user, request_id, band.value, decision, "unavailable")
        return _respond("unavailable")

    retrieved = {str(c.chunk_id): c for c in chunks}
    if not validate_output(result, set(retrieved), band_config.max_reply_chars):
        logger.warning("chat_output_rejected")  # e.g. a citation of an unretrieved passage
        _record(session, user, request_id, band.value, decision, "unable_to_answer")
        return _respond("unable_to_answer")

    _record(session, user, request_id, band.value, decision, "reply")
    citations = [
        Citation(
            chunk_id=retrieved[cid].chunk_id,
            source_title=retrieved[cid].title,
            publisher=retrieved[cid].publisher,
            source_ref=retrieved[cid].source_ref,
            version_label=retrieved[cid].version_label,
            synthetic=retrieved[cid].synthetic,
            review_status=retrieved[cid].review_status,
        )
        for cid in dict.fromkeys(result.cited_chunk_ids)
    ]
    model_name = getattr(runtime.provider, "model_name", None)
    response = ChatResponse(
        status="reply",
        reply=ChatReply(
            text=result.text,
            signature=sign_turn(runtime.signing_key, user.id, result.text),
            citations=citations,
            model=model_name,
        ),
        topic=TopicOut(prompt_id=intent_id, question=topic_question)
        if intent_id and topic_question
        else _topic(intent_id, language),
    )
    if not saving or cipher is None:
        return response

    # --- Opted in: save the question and the validated reply (never refusals) ---
    if conversation is None:
        title = _canonical(intent_id, language) if intent_id else payload.message
        conversation = history_store.create_conversation(session, cipher, user.id, title or "")
        conversation = history_store.get_conversation(session, user.id, conversation.id, lock=True)
        assert conversation is not None  # noqa: S101 - just created in this transaction
    question, answer = history_store.append_turn(
        session,
        cipher,
        conversation,
        user_text=payload.message,
        intent_id=intent_id,
        user_language=language,
        reply_text=result.text,
        reply_language="ar" if _ARABIC.search(result.text) else "en",
        citations=[c.model_dump(mode="json") for c in citations],
        model=model_name,
        client_message_id=payload.client_message_id,
    )
    return _saved_response(runtime, user, conversation, question, answer, topic=response.topic)
