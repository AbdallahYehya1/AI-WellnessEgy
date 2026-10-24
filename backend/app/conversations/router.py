"""Chat endpoints (prototype; disabled unless CHAT_ENABLED).

Saved-history endpoints act only on the verified caller's own conversations: the owner
is always the user from the Supabase token, never an id from the request, and another
user's conversation answers exactly like a missing one (404).
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response

from app.ai.prompts.age_bands import AGE_BANDS, band_enabled, resolve_age_band
from app.assistants.registry import ASSISTANTS, BY_ID
from app.auth.dependencies import CurrentPrincipal
from app.common.errors import ApiError, ErrorResponse
from app.consent.dependencies import ConsentedUser
from app.conversations import history as history_store
from app.conversations.crypto import HistoryCipher
from app.conversations.demo import DEMO_PROMPTS, is_allowed
from app.conversations.schemas import (
    AssistantOut,
    ChatConfig,
    ChatRequest,
    ChatResponse,
    ConversationDetail,
    ConversationPage,
    ConversationSummary,
    DemoPromptOut,
    HistorySettings,
    HistorySettingsUpdate,
    RenameRequest,
    SupportedTopic,
)
from app.conversations.service import (
    ChatRuntime,
    conversation_summary,
    handle_message,
    stored_message_out,
)
from app.core.db import DbSession
from app.users.models import User
from app.users.service import get_or_create_user

router = APIRouter(prefix="/chat", tags=["chat"])

ERRORS: dict[int | str, dict[str, object]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 404, 409, 422, 429, 503)
}


def _assistants() -> list[AssistantOut]:
    return [
        AssistantOut(
            assistant_id=a.assistant_id,
            status=a.status,
            icon=a.icon,
            name_en=a.name_en,
            name_ar=a.name_ar,
            description_en=a.description_en,
            description_ar=a.description_ar,
            starters_en=list(a.starters_en),
            starters_ar=list(a.starters_ar),
        )
        for a in ASSISTANTS
    ]


def _runtime(request: Request) -> ChatRuntime | None:
    runtime: ChatRuntime | None = request.app.state.chat_runtime
    return runtime


def _allowed(runtime: ChatRuntime | None, principal: CurrentPrincipal) -> bool:
    return runtime is not None and (
        not runtime.demo_curated
        or is_allowed(principal, runtime.demo_allowed, everyone=runtime.demo_all_consented_adults)
    )


def _history_settings(runtime: ChatRuntime | None, user: User) -> HistorySettings:
    available = runtime is not None and runtime.history is not None
    return HistorySettings(
        available=available,
        enabled=available and user.chat_history_enabled,
        consent_version=history_store.HISTORY_CONSENT_VERSION,
        consented_version=user.chat_history_consent_version,
        retention_days=runtime.history_retention_days if runtime is not None else 90,
        max_conversations=history_store.MAX_CONVERSATIONS,
    )


def _cipher(runtime: ChatRuntime | None) -> HistoryCipher:
    if runtime is None or runtime.history is None:
        raise ApiError(503, "history_unavailable", "Saved chat history isn't available.")
    return runtime.history


@router.get("/config", response_model=ChatConfig, responses=ERRORS)
def read_config(request: Request, user: ConsentedUser, principal: CurrentPrincipal) -> ChatConfig:
    runtime = _runtime(request)
    band = resolve_age_band()
    allowed = _allowed(runtime, principal)
    curated = runtime is not None and runtime.demo_curated
    return ChatConfig(
        enabled=runtime is not None and band_enabled(band) and allowed,
        demo_curated=curated,
        demo_prompts=[
            DemoPromptOut(prompt_id=p.prompt_id, en=p.en, ar=p.ar, follow_up=p.follow_up)
            for p in DEMO_PROMPTS
        ]
        if curated and allowed
        else [],
        age_band=band.value,
        age_band_label=AGE_BANDS[band].label,
        test_only_policy=runtime is not None and runtime.policy.synthetic,
        generator=getattr(runtime.provider, "kind", None) if runtime is not None else None,
        model=getattr(runtime.provider, "model_name", None) if runtime is not None else None,
        typed_input="topics" if curated or runtime is None else "free",
        supported_topics=[
            SupportedTopic(prompt_id=p.prompt_id, en=p.en, ar=p.ar)
            for p in DEMO_PROMPTS
            if not p.follow_up
        ],
        history=_history_settings(runtime, user) if allowed else None,
        assistants=_assistants() if curated and allowed else [],
    )


@router.post("/messages", response_model=ChatResponse, responses=ERRORS)
def post_message(
    payload: ChatRequest,
    request: Request,
    user: ConsentedUser,
    principal: CurrentPrincipal,
    session: DbSession,
) -> ChatResponse:
    runtime = _runtime(request)
    if runtime is None:
        raise ApiError(503, "chat_unavailable", "The assistant isn't available.")
    if not _allowed(runtime, principal):
        raise ApiError(403, "chat_not_enabled", "The assistant isn't available for this account.")
    return handle_message(session, user, runtime, payload)


# --- Saved history (opt-in) --------------------------------------------------------------


@router.get("/history", response_model=HistorySettings, responses=ERRORS)
def read_history_settings(request: Request, user: ConsentedUser) -> HistorySettings:
    return _history_settings(_runtime(request), user)


@router.put("/history", response_model=HistorySettings, responses=ERRORS)
def update_history_settings(
    payload: HistorySettingsUpdate, request: Request, user: ConsentedUser, session: DbSession
) -> HistorySettings:
    runtime = _runtime(request)
    if payload.enabled:
        _cipher(runtime)
        if payload.consent_version != history_store.HISTORY_CONSENT_VERSION:
            raise ApiError(
                422,
                "history_consent_required",
                "Please read and accept the current notice about saved chats.",
            )
    history_store.set_history_enabled(session, user, payload.enabled)
    return _history_settings(runtime, user)


Limit = Annotated[int, Query(ge=1, le=50)]


@router.get("/conversations", response_model=ConversationPage, responses=ERRORS)
def list_conversations(
    request: Request,
    user: ConsentedUser,
    session: DbSession,
    limit: Limit = 30,
    cursor: Annotated[str | None, Query(max_length=200)] = None,
    q: Annotated[str | None, Query(max_length=80)] = None,
    assistant: Annotated[str | None, Query(max_length=40)] = None,
) -> ConversationPage:
    runtime = _runtime(request)
    if assistant is not None and assistant not in BY_ID:
        raise ApiError(422, "unknown_assistant", "This assistant doesn't exist.")
    cipher = _cipher(runtime)
    assert runtime is not None  # noqa: S101 - _cipher checked it
    history_store.purge_expired(session, user.id, runtime.history_retention_days)
    rows, next_cursor = history_store.list_conversations(
        session,
        cipher,
        user.id,
        limit=limit,
        cursor=cursor,
        query=(q or "").strip() or None,
        assistant_id=assistant,
    )
    return ConversationPage(
        conversations=[
            ConversationSummary(
                conversation_id=c.id,
                assistant_id=c.assistant_id,
                title=title,
                message_count=c.message_count,
                created_at=c.created_at,
                last_activity_at=c.last_activity_at,
            )
            for c, title in rows
        ],
        next_cursor=next_cursor,
    )


@router.get("/conversations/{conversation_id}", response_model=ConversationDetail, responses=ERRORS)
def read_conversation(
    conversation_id: uuid.UUID,
    request: Request,
    user: ConsentedUser,
    session: DbSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before: Annotated[int | None, Query(ge=1)] = None,
) -> ConversationDetail:
    runtime = _runtime(request)
    cipher = _cipher(runtime)
    assert runtime is not None  # noqa: S101
    conversation = history_store.get_conversation(session, user.id, conversation_id)
    if conversation is None:
        raise ApiError(404, "conversation_not_found", "This conversation doesn't exist.")
    turns, next_before = history_store.read_messages(
        session, cipher, user.id, conversation.id, limit=limit, before_seq=before
    )
    return ConversationDetail(
        conversation=conversation_summary(cipher, conversation),
        messages=[stored_message_out(runtime, user, t) for t in turns],
        next_before=next_before,
    )


@router.patch(
    "/conversations/{conversation_id}", response_model=ConversationSummary, responses=ERRORS
)
def rename_conversation(
    conversation_id: uuid.UUID,
    payload: RenameRequest,
    request: Request,
    user: ConsentedUser,
    session: DbSession,
) -> ConversationSummary:
    cipher = _cipher(_runtime(request))
    conversation = history_store.rename_conversation(
        session, cipher, user.id, conversation_id, payload.title
    )
    if conversation is None:
        raise ApiError(404, "conversation_not_found", "This conversation doesn't exist.")
    return conversation_summary(cipher, conversation)


# Deletion needs only a signed-in user (not current consent): people can always remove
# what they saved, even after declining updated terms.


@router.delete(
    "/conversations/{conversation_id}", status_code=204, response_class=Response, responses=ERRORS
)
def delete_conversation(
    conversation_id: uuid.UUID, principal: CurrentPrincipal, session: DbSession
) -> Response:
    user = get_or_create_user(session, principal)
    if not history_store.delete_conversation(session, user.id, conversation_id):
        raise ApiError(404, "conversation_not_found", "This conversation doesn't exist.")
    return Response(status_code=204)


@router.delete("/conversations", status_code=204, response_class=Response, responses=ERRORS)
def delete_all_conversations(principal: CurrentPrincipal, session: DbSession) -> Response:
    user = get_or_create_user(session, principal)
    history_store.delete_all_conversations(session, user.id)
    return Response(status_code=204)
