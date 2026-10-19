"""Chat endpoints (prototype; disabled unless CHAT_ENABLED)."""

from __future__ import annotations

from fastapi import APIRouter, Request

from app.ai.prompts.age_bands import AGE_BANDS, band_enabled, resolve_age_band
from app.auth.dependencies import CurrentPrincipal
from app.common.errors import ApiError, ErrorResponse
from app.consent.dependencies import ConsentedUser
from app.conversations.demo import DEMO_PROMPTS, is_allowed
from app.conversations.schemas import ChatConfig, ChatRequest, ChatResponse, DemoPromptOut
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
def read_config(request: Request, user: ConsentedUser, principal: CurrentPrincipal) -> ChatConfig:
    runtime = _runtime(request)
    band = resolve_age_band()
    allowed = runtime is not None and (
        not runtime.demo_curated or is_allowed(principal, runtime.demo_allowed)
    )
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
    if runtime.demo_curated and not is_allowed(principal, runtime.demo_allowed):
        raise ApiError(403, "chat_not_enabled", "The assistant isn't available for this account.")
    return handle_message(session, user, runtime, payload)
