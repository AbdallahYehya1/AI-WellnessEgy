"""Profile request/response schemas.

Only the fields in docs/DATA_MODEL.md exist. `goals` and `preferences` are
validated against vocabularies that are intentionally empty until the
product decides them (docs/OPEN_DECISIONS.md, D-22 and D-23): no goal value
or preference key is invented here.
"""

from __future__ import annotations

import unicodedata
from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.users.models import DISPLAY_NAME_MAX_LENGTH

# Controlled vocabulary for `goals`. Empty until approved (D-22).
GOAL_VOCABULARY: frozenset[str] = frozenset()
MAX_GOALS = 10


class ProfilePreferences(BaseModel):
    """Allowed preference keys. None are defined yet (D-23)."""

    model_config = ConfigDict(extra="forbid")


class ProfileResponse(BaseModel):
    user_id: UUID
    display_name: str | None
    goals: list[str]
    preferences: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class ProfileUpdate(BaseModel):
    """PATCH /profile body. Omitted fields are left unchanged; unknown fields
    (including any attempt to set `user_id`) are rejected."""

    model_config = ConfigDict(extra="forbid")

    display_name: str | None = None
    goals: list[str] | None = None
    preferences: ProfilePreferences | None = None

    @field_validator("display_name")
    @classmethod
    def _clean_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = unicodedata.normalize("NFC", value).strip()
        if not value:
            raise ValueError("Display name can't be empty. Send null to remove it.")
        if len(value) > DISPLAY_NAME_MAX_LENGTH:
            raise ValueError(f"Display name must be at most {DISPLAY_NAME_MAX_LENGTH} characters.")
        if any(unicodedata.category(ch) in {"Cc", "Cf", "Zl", "Zp"} for ch in value):
            raise ValueError("Display name contains characters that aren't allowed.")
        return value

    @field_validator("goals")
    @classmethod
    def _check_goals(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        if len(value) > MAX_GOALS or len(set(value)) != len(value):
            raise ValueError("Goals must be a short list without duplicates.")
        unknown = [goal for goal in value if goal not in GOAL_VOCABULARY]
        if unknown:
            raise ValueError("Unknown goal. Goals must come from the approved list.")
        return value


class MeResponse(BaseModel):
    user_id: UUID
    supabase_user_id: UUID
    email: str | None
    display_name: str | None
    created_at: datetime
