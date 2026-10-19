"""Chat pipeline. The order below is the safety architecture (G-3):

1. authentication + consent           (ConsentedUser dependency)
2. age band enabled                   (server-side allowlist)
3. history signatures valid           (forged assistant turns rejected)
4. rate limit                         (PostgreSQL; any failure = no generation)
5. safety assessment + decision       (whole window; failures = no generation)
6. approved, age-applicable retrieval (failure = unavailable; none = no_evidence)
7. generation permit                  (single-use, request-bound)
8. provider via generate_with_permit  (fake provider only)
9. output validation                  (citations must match retrieval)
10. metadata-only safety event        (never message text)

There is no other path to the provider.
"""

from __future__ import annotations

import concurrent.futures
import hashlib
import hmac
import uuid
from dataclasses import dataclass, field

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
from app.conversations.demo import DEMO_NOTICE, match_prompt
from app.conversations.schemas import ChatReply, ChatRequest, ChatResponse, ChatStatus, Citation
from app.core.logging import get_logger
from app.knowledge.retrieval import retrieve
from app.safety.assessor import SafetyAssessor, assess_safety_risk
from app.safety.contracts import Outcome, SafetyDecision
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


def handle_message(
    session: Session, user: User, runtime: ChatRuntime, payload: ChatRequest
) -> ChatResponse:
    band = resolve_age_band()
    if not band_enabled(band):
        raise ApiError(403, "age_band_unavailable", "This experience isn't available yet.")
    band_config = AGE_BANDS[band]

    for turn in payload.history:
        if turn.role == "assistant" and not _signature_valid(
            runtime.signing_key, user.id, turn.text, turn.signature or ""
        ):
            raise ApiError(422, "invalid_history", "The conversation history couldn't be verified.")

    if runtime.demo_curated:
        earlier = [t.text for t in payload.history if t.role == "user"]
        if match_prompt(payload.message, earlier) is None:
            # Refused before assessment, retrieval or any provider call.
            return ChatResponse(status="out_of_scope", notice=DEMO_NOTICE)

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

    request_id = uuid.uuid4()
    window = [t.text for t in payload.history if t.role == "user"] + [payload.message]
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
                payload.message,
                band.value,
                runtime.retrievable_statuses,
                # Follow-ups ("explain that in Arabic") borrow the topic of earlier
                # user turns; assistant turns are never used as search input.
                context=[t.text for t in payload.history if t.role == "user"],
            )
    except Exception as error:
        logger.error("chat_retrieval_unavailable", extra={"category": _failure_category(error)})
        _record(session, user, request_id, band.value, decision, "unavailable")
        return _respond("unavailable")
    if not chunks:
        logger.info("chat_no_evidence")
        _record(session, user, request_id, band.value, decision, "no_evidence")
        return _respond("no_evidence")

    permit = runtime.gate.authorize(decision, str(request_id), payload.message)
    generation = GenerationRequest(
        message=payload.message,
        history=[(t.role, t.text) for t in payload.history],
        passages=[Passage(chunk_id=str(c.chunk_id), text=c.content) for c in chunks],
        instructions=band_config.instructions,
        max_chars=band_config.max_reply_chars,
    )
    future = _PROVIDER_EXECUTOR.submit(
        generate_with_permit,
        runtime.gate,
        runtime.provider,
        permit,
        str(request_id),
        payload.message,
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
    return ChatResponse(
        status="reply",
        reply=ChatReply(
            text=result.text,
            signature=sign_turn(runtime.signing_key, user.id, result.text),
            citations=citations,
        ),
    )
