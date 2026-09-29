"""Identity endpoint.

M2 has no application ``users`` table, so ``/me`` reports only what the
verified token says. Profile data arrives in a later milestone.
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel

from app.auth.dependencies import CurrentPrincipal
from app.common.errors import ErrorResponse

router = APIRouter(tags=["users"])


class MeResponse(BaseModel):
    user_id: UUID
    email: str | None


@router.get(
    "/me",
    response_model=MeResponse,
    responses={401: {"model": ErrorResponse}, 503: {"model": ErrorResponse}},
)
def read_me(principal: CurrentPrincipal) -> MeResponse:
    # Identity comes only from the verified token. Any user id the client
    # sends (query, body or header) is ignored.
    return MeResponse(user_id=principal.user_id, email=principal.email)
