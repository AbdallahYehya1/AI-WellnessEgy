"""Identity and profile endpoints. All are self-only: the user is always the
one identified by the verified access token."""

from __future__ import annotations

from fastapi import APIRouter

from app.auth.dependencies import CurrentPrincipal
from app.common.errors import ErrorResponse
from app.core.db import DbSession
from app.users.models import User
from app.users.schemas import MeResponse, ProfileResponse, ProfileUpdate
from app.users.service import get_or_create_user, update_profile

router = APIRouter(tags=["users"])

ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


def _profile(user: User) -> ProfileResponse:
    return ProfileResponse(
        user_id=user.id,
        display_name=user.display_name,
        goals=list(user.goals),
        preferences=dict(user.preferences),
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


@router.get("/me", response_model=MeResponse, responses=ERRORS)
def read_me(principal: CurrentPrincipal, session: DbSession) -> MeResponse:
    # Creates the app-side profile on first use. Any user id the client
    # sends (query, body or header) is ignored.
    user = get_or_create_user(session, principal)
    return MeResponse(
        user_id=user.id,
        supabase_user_id=principal.user_id,
        email=principal.email,
        display_name=user.display_name,
        created_at=user.created_at,
    )


@router.get("/profile", response_model=ProfileResponse, responses=ERRORS)
def read_profile(principal: CurrentPrincipal, session: DbSession) -> ProfileResponse:
    return _profile(get_or_create_user(session, principal))


@router.patch("/profile", response_model=ProfileResponse, responses=ERRORS)
def patch_profile(
    changes: ProfileUpdate, principal: CurrentPrincipal, session: DbSession
) -> ProfileResponse:
    user = get_or_create_user(session, principal, lock=True)
    return _profile(update_profile(session, user, changes))
