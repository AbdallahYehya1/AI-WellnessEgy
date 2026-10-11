"""Mood service. Every query is scoped to the caller's own profile row."""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.service import record_event
from app.common.errors import ApiError
from app.mood.models import MoodCheckin
from app.mood.schemas import HistoryQuery, MoodCheckinCreate
from app.users.models import User


def record_checkin(session: Session, user: User, payload: MoodCheckinCreate) -> MoodCheckin:
    checkin = MoodCheckin(
        id=uuid.uuid4(),
        user_id=user.id,
        mood_score=payload.mood_score,
        tags=list(payload.tags),
        note=payload.note,
    )
    session.add(checkin)
    session.flush()
    session.refresh(checkin)
    # That a check-in happened, and to which row. Never the score, tags or note.
    record_event(
        session,
        action="mood.checkin_recorded",
        actor_user_id=user.id,
        target_type="mood_checkin",
        target_id=checkin.id,
    )
    return checkin


def checkin_history(session: Session, user: User, query: HistoryQuery) -> list[MoodCheckin]:
    if query.from_ is not None and query.to is not None and query.from_ >= query.to:
        raise ApiError(422, "invalid_range", "`from` must be earlier than `to`.")
    statement = select(MoodCheckin).where(MoodCheckin.user_id == user.id)
    if query.from_ is not None:
        statement = statement.where(MoodCheckin.submitted_at >= query.from_)
    if query.to is not None:
        statement = statement.where(MoodCheckin.submitted_at < query.to)
    statement = statement.order_by(MoodCheckin.submitted_at.desc(), MoodCheckin.id.desc()).limit(
        query.limit
    )
    return list(session.execute(statement).scalars())
