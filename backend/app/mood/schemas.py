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

from datetime import date, datetime
from typing import Annotated, Literal
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


# Daily Reflection (D-57). Labels, not a good-to-bad scale; several may apply at once.
EMOTIONS: tuple[str, ...] = (
    "happy",
    "calm",
    "good",
    "okay",
    "anxious",
    "sad",
    "frustrated",
    "tired",
    "excited",
)
FACTORS: tuple[str, ...] = (
    "work",
    "relationships",
    "family",
    "studies",
    "finances",
    "physical_health",
    "exercise",
    "sleep",
    "social",
    "goals",
    "other",
)


class ReflectionCreate(BaseModel):
    """POST /mood/reflections. No free-text note while D-32 is open."""

    model_config = ConfigDict(extra="forbid")

    emotions: list[str] = Field(min_length=1, max_length=len(EMOTIONS))
    factors: list[str] = Field(default_factory=list, max_length=len(FACTORS))

    @field_validator("emotions")
    @classmethod
    def _known_emotions(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(v not in EMOTIONS for v in value):
            raise ValueError("Choose feelings from the list, each once.")
        return value

    @field_validator("factors")
    @classmethod
    def _known_factors(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(v not in FACTORS for v in value):
            raise ValueError("Choose factors from the list, each once.")
        return value


class ReflectionCreated(BaseModel):
    checkin_id: UUID
    submitted_at: datetime
    # Optional next steps, never a diagnosis: ready assistants related to the factors.
    suggested_assistants: list[str]


class MoodCheckinOut(BaseModel):
    checkin_id: UUID
    kind: Literal["checkin", "reflection"]
    mood_score: int | None  # legacy 1-5 check-ins only
    emotions: list[str]
    factors: list[str]
    tags: list[str]
    note: str | None
    submitted_at: datetime


class CountItem(BaseModel):
    label: str
    count: int


class FactorLink(BaseModel):
    emotion: str
    factor: str
    days: int


class InsightDay(BaseModel):
    day: date
    emotions: list[str]


class Insights(BaseModel):
    """Descriptive counts only: no scores, causes or diagnoses."""

    period: Literal["week", "month"]
    start: date
    end: date  # exclusive
    reflections: int
    days_with_reflections: int
    enough_data: bool
    emotions: list[CountItem]
    factors: list[CountItem]
    links: list[FactorLink]  # "anxious on 4 days; work was marked on 3 of them"
    calendar: list[InsightDay]


class MoodHistory(BaseModel):
    checkins: list[MoodCheckinOut]


class HistoryQuery(BaseModel):
    """`from` (inclusive) and `to` (exclusive) must include a timezone."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    from_: AwareDatetime | None = Field(default=None, alias="from")
    to: AwareDatetime | None = None
    limit: int = Field(default=HISTORY_DEFAULT_LIMIT, ge=1, le=HISTORY_MAX_LIMIT)
