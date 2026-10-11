"""Mood endpoints. Self-only and gated on the current required consent:
the user is always the one identified by the verified access token."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.common.errors import ErrorResponse
from app.consent.dependencies import ConsentedUser
from app.core.db import DbSession
from app.mood.models import MoodCheckin
from app.mood.schemas import (
    HistoryQuery,
    MoodCheckinCreate,
    MoodCheckinCreated,
    MoodCheckinOut,
    MoodHistory,
)
from app.mood.service import checkin_history, record_checkin

router = APIRouter(prefix="/mood", tags=["mood"])

ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


def _out(checkin: MoodCheckin) -> MoodCheckinOut:
    return MoodCheckinOut(
        checkin_id=checkin.id,
        mood_score=checkin.mood_score,
        tags=list(checkin.tags),
        note=checkin.note,
        submitted_at=checkin.submitted_at,
    )


@router.post("/checkins", response_model=MoodCheckinCreated, status_code=201, responses=ERRORS)
def create_checkin(
    payload: MoodCheckinCreate, user: ConsentedUser, session: DbSession
) -> MoodCheckinCreated:
    checkin = record_checkin(session, user, payload)
    return MoodCheckinCreated(checkin_id=checkin.id, submitted_at=checkin.submitted_at)


@router.get("/history", response_model=MoodHistory, responses=ERRORS)
def read_history(
    query: Annotated[HistoryQuery, Query()], user: ConsentedUser, session: DbSession
) -> MoodHistory:
    """The caller's own check-ins, newest first."""
    return MoodHistory(checkins=[_out(c) for c in checkin_history(session, user, query)])
