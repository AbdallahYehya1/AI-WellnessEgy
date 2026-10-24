"""App-side user profile (docs/DATA_MODEL.md, `users`)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, String, false, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

DISPLAY_NAME_MAX_LENGTH = 50


class User(Base):
    """One row per Supabase Auth identity. Holds no credentials or email."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            f"char_length(display_name) BETWEEN 1 AND {DISPLAY_NAME_MAX_LENGTH}",
            name="display_name_length",
        ),
        CheckConstraint("jsonb_typeof(goals) = 'array'", name="goals_is_array"),
        CheckConstraint("jsonb_typeof(preferences) = 'object'", name="preferences_is_object"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    supabase_user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), unique=True)
    display_name: Mapped[str | None] = mapped_column(String(DISPLAY_NAME_MAX_LENGTH))
    goals: Mapped[list[str]] = mapped_column(JSONB, default=list, server_default="[]")
    preferences: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Saved chat history is off until the user explicitly opts in (D-54).
    chat_history_enabled: Mapped[bool] = mapped_column(default=False, server_default=false())
    chat_history_consent_version: Mapped[str | None] = mapped_column(String(40))
    chat_history_consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Opt-in to sending a privacy-minimised description of the situation to the provider
    # (D-59). NULL: not opted in, so only the structured question is sent.
    chat_context_consent_version: Mapped[str | None] = mapped_column(String(40))
    chat_context_consented_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
