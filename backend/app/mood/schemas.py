"""Mood API schemas (docs/API_CONTRACT.md, Mood).

The 1-5 scale is the documented `mood_score` range. Tags must come from a
controlled vocabulary that has not been defined yet, so none are accepted
(docs/OPEN_DECISIONS.md, D-30).

Notes: temporary policy while D-32 is open. Free-text notes are not collected
before the safety layer and the required clinical/legal decisions exist, so
any `note` string (including empty or whitespace-only) is rejected here,
before anything is written. An omitted or null `note` is still valid.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.mood.models import MAX_TAGS, MOOD_SCORE_MAX, MOOD_SCORE_MIN

# Controlled vocabulary for `tags`. Empty until approved (D-30).
TAG_VOCABULARY: frozenset[str] = frozenset()

HISTORY_DEFAULT_LIMIT = 30
HISTORY_MAX_LIMIT = 100


class MoodCheckinCreate(BaseModel):
    """POST /mood/checkins body. `mood_score` must be a JSON integer
    (not "3", 3.5 or true); unknown fields such as `user_id` are rejected."""

    model_config = ConfigDict(extra="forbid")

    mood_score: Annotated[StrictInt, Field(ge=MOOD_SCORE_MIN, le=MOOD_SCORE_MAX)]
    tags: list[str] = Field(default_factory=list)
    note: str | None = None

    @field_validator("tags")
    @classmethod
    def _check_tags(cls, value: list[str]) -> list[str]:
        if len(value) > MAX_TAGS or len(set(value)) != len(value):
            raise ValueError("Tags must be a short list without duplicates.")
        if any(tag not in TAG_VOCABULARY for tag in value):
            raise ValueError("Unknown tag. Tags must come from the approved list.")
        return value

    @field_validator("note")
    @classmethod
    def _reject_note(cls, value: str | None) -> None:
        # D-32: no free-text notes until the safety layer exists. The submitted
        # text is never echoed back, logged or stored.
        if value is None:
            return None
        raise ValueError("Notes aren't accepted yet. Leave the note out.")


class MoodCheckinCreated(BaseModel):
    checkin_id: UUID
    submitted_at: datetime


class MoodCheckinOut(BaseModel):
    checkin_id: UUID
    mood_score: int
    tags: list[str]
    note: str | None
    submitted_at: datetime


class MoodHistory(BaseModel):
    checkins: list[MoodCheckinOut]


class HistoryQuery(BaseModel):
    """`from` (inclusive) and `to` (exclusive) must include a timezone."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: AwareDatetime | None = Field(default=None, alias="from")
    to: AwareDatetime | None = None
    limit: int = Field(default=HISTORY_DEFAULT_LIMIT, ge=1, le=HISTORY_MAX_LIMIT)
