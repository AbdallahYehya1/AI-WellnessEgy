"""Profile service: the only way other modules obtain the current user row.

Ownership is structural: every lookup is keyed on the verified Supabase user
id from the access token, so there is no code path that loads a profile by
a client-supplied id.
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.audit.service import record_event
from app.auth.principal import AuthenticatedPrincipal
from app.common.errors import ApiError
from app.users.models import User
from app.users.schemas import ProfileUpdate


def get_or_create_user(
    session: Session, principal: AuthenticatedPrincipal, *, lock: bool = False
) -> User:
    """Load the caller's profile, creating it on first use (race-safe)."""
    created_id = session.execute(
        insert(User)
        .values(id=uuid.uuid4(), supabase_user_id=principal.user_id)
        .on_conflict_do_nothing(index_elements=[User.supabase_user_id])
        .returning(User.id)
    ).scalar_one_or_none()

    query = select(User).where(User.supabase_user_id == principal.user_id)
    if lock:
        query = query.with_for_update()
    user = session.execute(query).scalar_one()

    if created_id is not None:
        record_event(
            session,
            action="user.created",
            actor_user_id=user.id,
            target_type="user",
            target_id=user.id,
        )
    if user.deleted_at is not None:
        raise ApiError(403, "account_unavailable", "This account is no longer available.")
    return user


def update_profile(session: Session, user: User, changes: ProfileUpdate) -> User:
    changed: list[str] = []
    fields = changes.model_fields_set

    if "display_name" in fields and changes.display_name != user.display_name:
        user.display_name = changes.display_name
        changed.append("display_name")
    if "goals" in fields and changes.goals is not None and changes.goals != user.goals:
        user.goals = changes.goals
        changed.append("goals")
    if "preferences" in fields and changes.preferences is not None:
        preferences = changes.preferences.model_dump()
        if preferences != user.preferences:
            user.preferences = preferences
            changed.append("preferences")

    if changed:
        session.flush()
        session.refresh(user)
        # Field names only, never the values.
        record_event(
            session,
            action="user.profile_updated",
            actor_user_id=user.id,
            target_type="user",
            target_id=user.id,
            metadata={"fields": changed},
        )
    return user
