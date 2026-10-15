"""Chat endpoints (prototype; disabled unless CHAT_ENABLED)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.ai.prompts.age_bands import AGE_BANDS, band_enabled, resolve_age_band
from app.common.errors import ApiError, ErrorResponse
from app.consent.dependencies import ConsentedUser
from app.conversations.schemas import ChatConfig, ChatRequest, ChatResponse
from app.conversations.service import ChatRuntime, handle_message
from app.core.db import DbSession

router = APIRouter(prefix="/chat", tags=["chat"])

ERRORS: dict[int | str, dict[str, object]] = {
    code: {"model": ErrorResponse} for code in (401, 403, 422, 429, 503)
}


def _runtime(request: Request) -> ChatRuntime | None:
    runtime: ChatRuntime | None = request.app.state.chat_runtime
    return runtime


@router.get("/config", response_model=ChatConfig, responses=ERRORS)
def read_config(request: Request, user: ConsentedUser) -> ChatConfig:
    runtime = _runtime(request)
    band = resolve_age_band()
    return ChatConfig(
        enabled=runtime is not None and band_enabled(band),
        age_band=band.value,
        age_band_label=AGE_BANDS[band].label,
        test_only_policy=runtime is not None and runtime.policy.synthetic,
    )


@router.post("/messages", response_model=ChatResponse, responses=ERRORS)
def post_message(
    payload: ChatRequest, request: Request, user: ConsentedUser, session: DbSession
) -> ChatResponse:
    runtime = _runtime(request)
    if runtime is None:
        raise ApiError(503, "chat_unavailable", "The assistant isn't available.")
    return handle_message(session, user, runtime, payload)
