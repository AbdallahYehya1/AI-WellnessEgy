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
    GenerationResult,
    Passage,
    ProviderError,
)
from app.assistants.context import (
    CONTEXT_CONSENT_VERSION,
    ContextMode,
    provider_message,
    redact,
)
from app.assistants.registry import BY_ID as ASSISTANTS_BY_ID
from app.assistants.registry import LEGACY_ASSISTANT, Assistant
from app.assistants.understanding import (
    CAUTION_INSTRUCTIONS,
    MIN_EVIDENCE_OVERLAP,
    Understanding,
    evidence_overlap,
    evidence_question,
    refers_back,
    understand,
)
from app.common.errors import ApiError
from app.common.ratelimit import (
    allow_request,
    record_tokens,
    requests_last_day,
    tokens_last_day,
    user_requests_last_day,
)
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
    SupportKind,
    TopicOut,
)
from app.core.logging import get_logger
from app.knowledge.retrieval import (
    RetrievedChunk,
    retrieve,
    retrieve_hybrid,
    retrieve_safety_resources,
    safety_exclusions,
)
from app.safety.assessor import SafetyAssessor, assess_safety_risk
from app.safety.contracts import Assessment, Outcome, RiskLevel, SafetyDecision
from app.safety.gate import GenerationGate, PermitError, generate_with_permit
from app.safety.models import SafetyEvent
from app.safety.output import validate_output
from app.safety.policy import SafetyPolicy
from app.users.models import User

logger = get_logger(__name__)

NOTICES: dict[str, str] = {
    "support": (
        "It sounds like you may be going through something very painful, and you don't have "
        "to face it alone. If you might act on thoughts of harming yourself, or you are in "
        "danger now, call an ambulance on 123 or go to the nearest emergency department. In "
        "Egypt, the Ministry of Health mental health line, 16328, answers around the clock. "
        "If you can, tell someone you trust how you are feeling. This assistant can't give "
        "crisis support, but you can come back to it for everyday questions."
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
    "relationship_safety": (
        "What you describe may mean you are being hurt, threatened or controlled. That is not "
        "your fault, and you deserve to be safe. If you are in immediate danger in Egypt, call "
        "the police on 122 or an ambulance on 123. The National Council for Women's complaints "
        "office (15115) offers advice and support, and if a child is at risk, the Child Helpline "
        "is 16000. Talking to someone you trust can help. This assistant can't safely help with "
        "this situation, but you can keep using it for other questions."
    ),
    "medical": (
        "This may need medical care. If it could be an emergency, call an ambulance on 123 or "
        "go to the nearest emergency department now. This assistant can't assess symptoms or "
        "injuries."
    ),
    "danger": (
        "If anyone is in immediate danger, call the police on 122. This assistant can't help "
        "with harming anyone. If you are struggling with anger or thoughts of hurting someone, "
        "the Ministry of Health mental health line, 16328, can help."
    ),
}
ASSISTANT_REPLY_CHARS = 1600
STRUCTURED_FOLLOW_UP = (
    "(A follow-up from the same person about this situation: add a few more specific, "
    "practical next steps without repeating the earlier answer. Keep it brief.)"
)
# Nothing recognised and no passage clearly matches (P0, 2026-10-25): ask, never refuse.
CLARIFY_NOTICE = (
    "I want to make sure I answer the right thing. Could you say a little more, for example "
    "what happened or what you'd like to change? Or pick one of these:"
)
CLARIFY_NOTICE_AR = (
    "عايز أتأكد إني بجاوب على اللي تقصده. ممكن تقول تفاصيل أكتر شوية، زي إيه اللي حصل أو "
    "إيه اللي عايز تغيره؟ أو اختار حاجة من دول:"
)
_SENTENCE_END = re.compile(r"[.!?؟]\s")


def _fit(text_: str, max_chars: int) -> str:
    """A reply over the limit is cut at the last sentence that fits (not rejected)."""
    if len(text_) <= max_chars:
        return text_
    cut = text_[: max_chars - 1]
    ends = [m.end() for m in _SENTENCE_END.finditer(cut)]
    return (cut[: ends[-1]].rstrip() if ends else cut.rsplit(" ", 1)[0]) + " …"


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
    # Fair use (D-56): one account's model calls per 24 hours, inside the global cap.
    user_daily_limit: int = 25
    # Shared provider token budget per 24 hours across all assistants (D-59).
    daily_token_budget: int = 150_000
    # What the provider may receive about the situation (D-59). Anything but
    # "structured" applies only to users with current provider-context consent.
    context_mode: str = "structured"

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
    "regulated": (
        "I can't give investment, tax or legal advice. A qualified professional can help with "
        "that. I'm happy to help with the everyday side of it."
    ),
    "needs_detail": (
        "Could you tell me a little more about what's going on? For example, what happened, "
        "what you'd like to change, or what you've already tried."
    ),
    "daily_limit": (
        "You've reached today's limit for this free prototype. Please come back tomorrow."
    ),
    "shared_limit": (
        "The assistants have reached today's shared free limit. Please try again tomorrow."
    ),
}
_ASSISTANT_REFUSALS: dict[str, RefusalReason] = {
    "personal_details": "personal_details",
    "clinical": "clinical",
    "regulated": "regulated",
    "sensitive": "sensitive",
    "too_long": "too_long",
}
# Without a recognised subtopic, a message can still be answered from its own words
# when the user opted in to provider context (D-59): a follow-up, or a real description.
_CONTEXTUAL_OK = ("clarify",)
_MIN_SITUATION_WORDS = 5
# The model's risk flag (second layer, D-59) -> support response.
_MODEL_RISK_SUPPORT: dict[str, SupportKind] = {
    "self_harm": "crisis",
    "abuse": "relationship_safety",
    "medical_emergency": "medical",
    "danger": "danger",
}
_SUPPORT_NOTICE = {
    "crisis": "support",
    "relationship_safety": "relationship_safety",
    "medical": "medical",
    "danger": "danger",
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


def context_mode_for(runtime: ChatRuntime, user: User) -> ContextMode:
    """Anything beyond the structured question needs this user's current opt-in (D-59)."""
    if (
        runtime.context_mode in ("minimized", "original")
        and user.chat_context_consent_version == CONTEXT_CONSENT_VERSION
    ):
        return "original" if runtime.context_mode == "original" else "minimized"
    return "structured"


def _assistant_context(
    assistant: Assistant,
    stored: list[StoredTurn] | None,
    history: list[HistoryTurn],
    mode: ContextMode,
) -> _Context:
    """Assistant mode: each earlier user turn is re-read in the current context mode
    (composed question, or redacted situation for opted-in users). Saved turns are
    decrypted for the verified owner; browser turns arrive with signed replies. A crisis
    anywhere earlier still routes to support."""
    context = _Context()
    keep = False
    turns = (
        [(t.role, t.text) for t in stored]
        if stored is not None
        else [(h.role, h.text) for h in history]
    )
    for role, text_ in turns:
        if role == "user":
            u = understand(assistant, text_, has_history=bool(context.model_history))
            if u.outcome in ("crisis", "relationship_safety", "medical", "danger"):
                context.crisis = True
            keep = u.outcome == "accept" or u.outcome in _CONTEXTUAL_OK
            if keep and mode == "structured" and u.outcome in _CONTEXTUAL_OK:
                # Answered earlier as a follow-up or from a matching passage (only answered
                # turns are kept): re-expressed the same way, never in the user's words.
                previous = next(
                    (t for r, t in reversed(context.model_history) if r == "user"), None
                )
                context.search_context.append(text_)
                context.model_history.append(
                    (
                        "user",
                        _follow_up_of(previous)
                        if previous and refers_back(text_)
                        else evidence_question(assistant, u.language),
                    )
                )
            elif keep:
                context.search_context.append(text_)
                context.model_history.append(("user", provider_message(assistant, u, text_, mode)))
        elif keep:
            context.model_history.append(("assistant", text_))
    return context


def _safety_resources(
    session: Session, runtime: ChatRuntime, band: str, message: str
) -> list[Citation]:
    """Vetted information about abuse and getting help, shown with the safety notice.
    Retrieved locally (nothing is sent to the provider); failures just omit them."""
    try:
        with session.begin_nested():
            chunks = retrieve_safety_resources(
                session,
                free_text=redact(message).text,
                age_band=band,
                statuses=runtime.retrievable_statuses,
            )
    except Exception:
        logger.error("chat_safety_resources_unavailable")
        return []
    return [
        Citation(
            chunk_id=c.chunk_id,
            source_title=c.title,
            publisher=c.publisher,
            source_ref=c.source_ref,
            version_label=c.version_label,
            synthetic=c.synthetic,
            review_status=c.review_status,
        )
        for c in chunks
    ]


def _rejection_reason(result: object, max_chars: int) -> str:
    """Which validation rule failed (a category only; never the text)."""
    if not isinstance(result, GenerationResult):
        return "malformed"
    if not result.text.strip():
        return "empty"
    if len(result.text) > max_chars:
        return "too_long"
    return "citation_or_prohibited"


def _citation_out(raw: dict[str, Any]) -> Citation:
    return Citation.model_validate(raw)


def conversation_summary(
    cipher: HistoryCipher, conversation: ChatConversation
) -> ConversationSummary:
    return ConversationSummary(
        conversation_id=conversation.id,
        assistant_id=conversation.assistant_id,
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
        topic=(
            TopicOut(prompt_id="assistant", question=turn.query)
            # Only a composed question is shown back; a provider-context turn (D-59) is
            # the user's own message, already visible.
            if turn.query and not turn.query.startswith("Assistant area:")
            else _topic(turn.intent_id, turn.language)
        )
        if turn.role == "user"
        else None,
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
        assistant_id=conversation.assistant_id,
    )


def _follow_up_of(previous_question: str) -> str:
    """A structured follow-up: the previous composed question plus a fixed instruction
    (once, however long the chain of follow-ups)."""
    return f"{previous_question.removesuffix(f' {STRUCTURED_FOLLOW_UP}')} {STRUCTURED_FOLLOW_UP}"


def _sentence(phrase: str) -> str:
    return phrase[:1].upper() + phrase[1:]


def _evidence(
    session: Session,
    runtime: ChatRuntime,
    band: str,
    assistant: Assistant,
    u: Understanding,
    message: str,
) -> list[RetrievedChunk]:
    """Passages in the assistant's own and approved secondary domains that clearly match
    the (redacted) message. Local only; nothing is sent anywhere. Failure means none."""
    free_text = redact(message).text
    try:
        with session.begin_nested():
            chunks = retrieve_hybrid(
                session,
                english="",
                arabic="",
                free_text=free_text,
                language=u.language,
                age_band=band,
                statuses=runtime.retrievable_statuses,
                domains=(assistant.domain, *assistant.secondary_domains),
                exclude=safety_exclusions(message),
            )
    except Exception as error:
        logger.error("chat_evidence_unavailable", extra={"category": _failure_category(error)})
        return []
    return [c for c in chunks if evidence_overlap(free_text, c.content) >= MIN_EVIDENCE_OVERLAP]


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
    stored_turns: list[StoredTurn] | None = None
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
        stored_turns = history_store.recent_turns(session, cipher, user.id, conversation.id)
        context = _stored_context(runtime, stored_turns)
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

    # --- Which assistant (D-56): a saved conversation keeps its own ---
    if (
        conversation is not None
        and payload.assistant_id is not None
        and payload.assistant_id != conversation.assistant_id
    ):
        raise ApiError(409, "assistant_mismatch", "This conversation belongs to another assistant.")
    assistant_id = (
        payload.assistant_id
        or (conversation.assistant_id if conversation is not None else None)
        or LEGACY_ASSISTANT
    )
    assistant = ASSISTANTS_BY_ID.get(assistant_id)
    if assistant is None:
        raise ApiError(422, "unknown_assistant", "This assistant doesn't exist.")
    if assistant.status != "ready":
        raise ApiError(403, "assistant_unavailable", "This assistant isn't available yet.")
    # Every assistant, Emotional Wellbeing included, runs the assistant pipeline when the
    # client names it (the web app always does). Requests without an assistant id (older
    # clients) keep the original seven-topic behaviour.
    assistant_mode = runtime.demo_curated and (
        assistant.assistant_id != LEGACY_ASSISTANT or payload.assistant_id is not None
    )
    # Every assistant searches its own domain, in every mode (D-56).
    search_domains: tuple[str, ...] = (assistant.domain,)
    understanding: Understanding | None = None
    search_en = search_ar = ""
    mode: ContextMode = "structured"
    free_text = ""
    provider_context: str | None = None
    evidence_chunks: list[RetrievedChunk] | None = None
    if assistant_mode:
        mode = context_mode_for(runtime, user)
        context = _assistant_context(
            assistant, stored_turns, payload.history if conversation is None else [], mode
        )

    # --- Typed-input gate (topic mode): refused before limits, retrieval or any model ---
    request_id = uuid.uuid4()
    language = "ar" if _ARABIC.search(payload.message) else "en"
    intent_id: str | None = None
    message = payload.message  # assessed and searched
    model_question = payload.message  # what the model is asked
    topic_question: str | None = None
    if assistant_mode:
        u = understand(assistant, payload.message, has_history=bool(context.model_history))
        if u.outcome == "personal_details" and mode != "structured":
            # Opted-in context: identifiers are removed instead of refusing the message.
            u = understand(
                assistant, redact(payload.message).text, has_history=bool(context.model_history)
            )
        if u.outcome in ("crisis", "relationship_safety", "medical", "danger") or context.crisis:
            kind: SupportKind = (
                u.outcome if u.outcome in ("relationship_safety", "medical", "danger") else "crisis"
            )
            decision = SafetyDecision(
                risk_level=RiskLevel.HIGH,
                outcome=Outcome.SUPPORT,
                policy_version=runtime.policy.policy_id,
                reason_code=f"assistant_{kind}",
            )
            _record(session, user, request_id, band.value, decision, "support")
            return ChatResponse(
                status="support",
                notice=NOTICES[_SUPPORT_NOTICE[kind]],
                support_kind=kind,
                assistant_id=assistant.assistant_id,
                resources=_safety_resources(session, runtime, band.value, payload.message)
                if kind == "relationship_safety"
                else [],
            )
        # A follow-up with no topic words of its own continues the same situation. In
        # structured mode it is re-expressed from the previous composed question, so the
        # user's words still never reach the provider.
        structured_follow_up = (
            mode == "structured"
            and u.outcome in _CONTEXTUAL_OK
            and bool(context.model_history)
            and refers_back(payload.message)
        )
        contextual = structured_follow_up or (
            mode != "structured"
            and u.outcome in _CONTEXTUAL_OK
            and (
                bool(context.model_history) or len(payload.message.split()) >= _MIN_SITUATION_WORDS
            )
        )
        if u.outcome not in ("accept", *_CONTEXTUAL_OK):
            # A harmful or professional-only request (or a long or identifying message):
            # the only refusals left in assistant mode. Topic never refuses (P0).
            logger.info(
                "chat_input_refused", extra={"reason": u.outcome, "assistant": assistant_id}
            )
            refusal = _refuse(_ASSISTANT_REFUSALS.get(u.outcome, "sensitive"))
            refusal.handoff = u.handoff
            refusal.assistant_id = assistant.assistant_id
            return refusal
        if u.outcome in _CONTEXTUAL_OK and not contextual:
            # Nothing recognised: look for a clearly matching public passage (local), else
            # ask for a little more. Neither is a refusal, and no quota is used to ask.
            evidence = _evidence(session, runtime, band.value, assistant, u, payload.message)
            if not evidence:
                logger.info("chat_route", extra={"route": "clarify", "assistant": assistant_id})
                return ChatResponse(
                    status="clarify",
                    notice=CLARIFY_NOTICE_AR if u.language == "ar" else CLARIFY_NOTICE,
                    assistant_id=assistant.assistant_id,
                    handoff=u.handoff,
                    suggestions=[
                        _sentence(s.phrase_ar if u.language == "ar" else s.phrase_en)
                        for s in u.suggestions
                    ],
                )
            evidence_chunks = evidence
        logger.info(
            "chat_route",
            extra={
                "route": "evidence" if evidence_chunks is not None else u.route,
                "assistant": assistant_id,
                "caution": u.caution,
            },
        )
        understanding = u
        language = u.language
        if (u.follow_up or not u.subtopics) and context.search_context:
            # A follow-up searches the topic of the previous question again.
            previous = understand(assistant, context.search_context[-1], has_history=False)
            search_en, search_ar = previous.search_en, previous.search_ar
            secondary = previous.secondary_domains
        else:
            search_en, search_ar, secondary = u.search_en, u.search_ar, u.secondary_domains
        search_domains = (assistant.domain, *secondary)
        message = model_question = provider_message(assistant, u, payload.message, mode)
        # Retrieval is local, so the (redacted) words always help find evidence (D-61);
        # what reaches the provider still depends on the mode.
        free_text = redact(payload.message).text
        if structured_follow_up:
            previous_question = next(t for r, t in reversed(context.model_history) if r == "user")
            message = model_question = topic_question = _follow_up_of(previous_question)
        elif evidence_chunks is not None:
            message = model_question = evidence_question(assistant, language)
            topic_question = (
                f"إرشادات عامة من: {evidence_chunks[0].title}"
                if language == "ar"
                else f"General guidance from: {evidence_chunks[0].title}"
            )
            if mode != "structured":
                provider_context = free_text if mode == "minimized" else payload.message
                message = model_question = provider_message(assistant, u, payload.message, mode)
        elif mode == "structured":
            topic_question = u.question
        else:
            provider_context = free_text if mode == "minimized" else payload.message
    elif runtime.demo_curated:
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
        try:
            with session.begin_nested():
                mine = user_requests_last_day(session, user.id)
        except Exception:  # cannot tell: fail closed
            logger.error("chat_user_limit_unavailable")
            return _respond("unavailable")
        if mine > runtime.user_daily_limit:
            logger.info("chat_user_daily_limit_reached")
            return ChatResponse(
                status="unavailable",
                notice=REFUSAL_NOTICES["daily_limit"],
                refusal_reason="daily_limit",
            )
        try:
            with session.begin_nested():
                tokens_used = tokens_last_day(session)
        except Exception:  # cannot tell: fail closed
            logger.error("chat_token_budget_unavailable")
            return _respond("unavailable")
        if tokens_used >= runtime.daily_token_budget:
            logger.warning("chat_token_budget_reached")
            return ChatResponse(
                status="unavailable",
                notice=REFUSAL_NOTICES["shared_limit"],
                refusal_reason="shared_limit",
            )

    if assistant_mode:
        # Screened by understand() above; the curated assessor only knows the reviewed
        # wellbeing questions. The policy still makes the decision.
        decision = runtime.policy.decide(
            Assessment(RiskLevel.LOW, reason_code="assistant_screened")
        )
    else:
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
            if evidence_chunks is not None:
                chunks = evidence_chunks  # already retrieved locally to route the message
            elif assistant_mode:
                chunks = retrieve_hybrid(
                    session,
                    english=search_en,
                    arabic=search_ar,
                    free_text=free_text,
                    language=language,
                    age_band=band.value,
                    statuses=runtime.retrievable_statuses,
                    domains=search_domains,
                    exclude=safety_exclusions(payload.message),
                )
            else:
                chunks = retrieve(
                    session,
                    message,
                    band.value,
                    runtime.retrievable_statuses,
                    # Follow-ups ("explain that in Arabic") borrow the topic of earlier
                    # user turns (their reviewed questions in topic mode); assistant turns
                    # are never search input, so sources are always freshly retrieved.
                    context=context.search_context,
                    domains=search_domains,
                )
    except Exception as error:
        logger.error("chat_retrieval_unavailable", extra={"category": _failure_category(error)})
        _record(session, user, request_id, band.value, decision, "unavailable")
        return _respond("unavailable")
    if not chunks and not assistant_mode:  # assistants may coach without passages (D-59)
        logger.info("chat_no_evidence")
        _record(session, user, request_id, band.value, decision, "no_evidence")
        return _respond("no_evidence")

    instructions = assistant.instructions if assistant_mode else band_config.instructions
    if understanding is not None and understanding.caution:
        instructions = f"{instructions} {CAUTION_INSTRUCTIONS[understanding.caution]}"
    permit = runtime.gate.authorize(decision, str(request_id), model_question)
    generation = GenerationRequest(
        message=model_question,
        history=context.model_history[-history_store.CONTEXT_TURNS * 2 :],
        passages=[Passage(chunk_id=str(c.chunk_id), text=c.content) for c in chunks],
        instructions=instructions,
        max_chars=ASSISTANT_REPLY_CHARS if assistant_mode else band_config.max_reply_chars,
        reply_language=language,
        coaching=assistant_mode,
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

    if result.total_tokens is not None:
        try:
            with session.begin_nested():
                record_tokens(session, user.id, result.total_tokens)
        except Exception:  # accounting must not lose the answer; it is logged
            logger.error("chat_token_record_failed")
    if assistant_mode and result.risk in _MODEL_RISK_SUPPORT:
        # The model read the situation as risky although the screens didn't: support,
        # never the generated text (D-59, second layer).
        kind = _MODEL_RISK_SUPPORT[result.risk]
        risk_decision = SafetyDecision(
            risk_level=RiskLevel.HIGH,
            outcome=Outcome.SUPPORT,
            policy_version=runtime.policy.policy_id,
            reason_code=f"model_risk_{result.risk}",
        )
        _record(session, user, request_id, band.value, risk_decision, "support")
        return ChatResponse(
            status="support",
            notice=NOTICES[_SUPPORT_NOTICE[kind]],
            support_kind=kind,
            assistant_id=assistant.assistant_id,
            resources=_safety_resources(session, runtime, band.value, payload.message)
            if kind == "relationship_safety"
            else [],
        )

    retrieved = {str(c.chunk_id): c for c in chunks}
    max_chars = ASSISTANT_REPLY_CHARS if assistant_mode else band_config.max_reply_chars
    if assistant_mode and isinstance(result, GenerationResult):
        # Coaching replies: trim instead of discarding, and never show a citation of a
        # passage that wasn't retrieved (the reply is then labelled general guidance).
        unknown = [c for c in result.cited_chunk_ids if c not in retrieved]
        if unknown or len(result.text) > max_chars:
            logger.info(
                "chat_output_adjusted",
                extra={"unknown_citations": len(unknown), "trimmed": len(result.text) > max_chars},
            )
            result = GenerationResult(
                text=_fit(result.text, max_chars),
                cited_chunk_ids=[c for c in result.cited_chunk_ids if c in retrieved],
                risk=result.risk,
                total_tokens=result.total_tokens,
            )
    if not validate_output(result, set(retrieved), max_chars, allow_uncited=assistant_mode):
        logger.warning(
            "chat_output_rejected", extra={"reason": _rejection_reason(result, max_chars)}
        )
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
        topic=TopicOut(prompt_id=intent_id or assistant.assistant_id, question=topic_question)
        if topic_question
        else _topic(intent_id, language),
        assistant_id=assistant.assistant_id,
        handoff=understanding.handoff if understanding is not None else None,
        provider_context=provider_context,
    )
    if not saving or cipher is None:
        return response

    # --- Opted in: save the question and the validated reply (never refusals) ---
    if conversation is None:
        if understanding is not None and understanding.subtopics:
            first = understanding.subtopics[0]
            phrase = first.phrase_ar if language == "ar" else first.phrase_en
            title = phrase[:1].upper() + phrase[1:]
        elif assistant_mode:  # encrypted at rest and never sent to the provider
            title = " ".join(payload.message.split())[:60]
        else:
            title = (_canonical(intent_id, language) if intent_id else payload.message) or ""
        conversation = history_store.create_conversation(
            session, cipher, user.id, title, assistant_id=assistant.assistant_id
        )
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
        query_text=model_question if assistant_mode else None,
    )
    return _saved_response(runtime, user, conversation, question, answer, topic=response.topic)
