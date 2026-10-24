"""Mood endpoints. Self-only and gated on the current required consent:
the user is always the one identified by the verified access token."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Query

from app.common.errors import ErrorResponse
from app.consent.dependencies import ConsentedUser
from app.core.db import DbSession
from app.mood.insights import build_insights, suggested_assistants
from app.mood.models import MoodCheckin
from app.mood.schemas import (
    HistoryQuery,
    Insights,
    MoodCheckinCreate,
    MoodCheckinCreated,
    MoodCheckinOut,
    MoodHistory,
    ReflectionCreate,
    ReflectionCreated,
)
from app.mood.service import checkin_history, record_checkin, record_reflection

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
        kind="reflection" if checkin.entry_version == 2 else "checkin",
        mood_score=checkin.mood_score,
        emotions=list(checkin.emotions or []),
        factors=list(checkin.factors or []),
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


@router.post("/reflections", response_model=ReflectionCreated, status_code=201, responses=ERRORS)
def create_reflection(
    payload: ReflectionCreate, user: ConsentedUser, session: DbSession
) -> ReflectionCreated:
    """Daily Reflection: one or more feelings and optional factors (no score, no note)."""
    reflection = record_reflection(session, user, payload)
    return ReflectionCreated(
        checkin_id=reflection.id,
        submitted_at=reflection.submitted_at,
        suggested_assistants=suggested_assistants(payload.emotions, payload.factors),
    )


@router.get("/insights", response_model=Insights, responses=ERRORS)
def read_insights(
    user: ConsentedUser,
    session: DbSession,
    period: Literal["week", "month"] = "week",
    tz_offset: Annotated[int, Query(ge=-840, le=840)] = 120,
) -> Insights:
    """Descriptive counts of the caller's own reflections; `tz_offset` is minutes east of
    UTC, so weeks and days follow the person's own calendar."""
    return build_insights(session, user, period, tz_offset)


@router.get("/history", response_model=MoodHistory, responses=ERRORS)
def read_history(
    query: Annotated[HistoryQuery, Query()], user: ConsentedUser, session: DbSession
) -> MoodHistory:
    """The caller's own check-ins, newest first."""
    return MoodHistory(checkins=[_out(c) for c in checkin_history(session, user, query)])
