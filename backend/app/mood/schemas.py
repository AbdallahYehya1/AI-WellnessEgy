"""Mood API schemas (docs/API_CONTRACT.md, Mood).

The 1-5 scale is the documented `mood_score` range. Tags must come from a
controlled vocabulary that has not been defined yet, so none are accepted
(docs/OPEN_DECISIONS.md, D-30). Notes are stored exactly as submitted:
they are validated, never trimmed or rewritten.
"""

from __future__ import annotations

import unicodedata
from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.mood.models import MAX_TAGS, MOOD_SCORE_MAX, MOOD_SCORE_MIN, NOTE_MAX_LENGTH

# Controlled vocabulary for `tags`. Empty until approved (D-30).
TAG_VOCABULARY: frozenset[str] = frozenset()

HISTORY_DEFAULT_LIMIT = 30
HISTORY_MAX_LIMIT = 100

# Line breaks and tabs are normal in a note; other control/format characters are not.
_ALLOWED_CONTROLS = {"\n", "\r", "\t"}


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
    def _check_note(cls, value: str | None) -> str | None:
        if value is None:
            return None
        if not value.strip():
            raise ValueError("The note can't be empty. Leave it out instead.")
        if len(value) > NOTE_MAX_LENGTH:
            raise ValueError(f"The note must be at most {NOTE_MAX_LENGTH} characters.")
        if any(
            unicodedata.category(ch) in {"Cc", "Cf"} and ch not in _ALLOWED_CONTROLS for ch in value
        ):
            raise ValueError("The note contains characters that aren't allowed.")
        return value  # stored exactly as written


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
