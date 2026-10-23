"""Mood check-ins (docs/DATA_MODEL.md, `mood_checkins`).

`note` is sensitive free text (treated like conversation data). It is never
logged, never copied into audit events, and must never be used as input to
any clinical assessment.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, SmallInteger, Text, func
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base

MOOD_SCORE_MIN = 1
MOOD_SCORE_MAX = 5
NOTE_MAX_LENGTH = 1000
MAX_TAGS = 10


class MoodCheckin(Base):
    __tablename__ = "mood_checkins"
    __table_args__ = (
        CheckConstraint(
            f"mood_score IS NULL OR mood_score BETWEEN {MOOD_SCORE_MIN} AND {MOOD_SCORE_MAX}",
            name="mood_score_range",
        ),
        CheckConstraint(
            "(entry_version = 1 AND mood_score IS NOT NULL) OR "
            "(entry_version = 2 AND mood_score IS NULL AND cardinality(emotions) BETWEEN 1 AND 9)",
            name="entry_valid",
        ),
        CheckConstraint("cardinality(factors) <= 11", name="factors_count"),
        CheckConstraint(f"cardinality(tags) <= {MAX_TAGS}", name="tags_count"),
        CheckConstraint(
            f"note IS NULL OR char_length(note) BETWEEN 1 AND {NOTE_MAX_LENGTH}",
            name="note_length",
        ),
        Index("ix_mood_checkins_user_submitted", "user_id", "submitted_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    # Version 1 (legacy check-in): a 1-5 score. Version 2 (Daily Reflection): emotions and
    # optional factors, no score. Old scores are never reinterpreted as emotions.
    mood_score: Mapped[int | None] = mapped_column(SmallInteger)
    emotions: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, server_default="{}")
    factors: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, server_default="{}")
    note_enc: Mapped[str | None] = mapped_column(Text)  # private note, encrypted by the backend
    entry_version: Mapped[int] = mapped_column(SmallInteger, default=1, server_default="1")
    tags: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, server_default="{}")
    note: Mapped[str | None] = mapped_column(Text)
    # Set by the database, never by the client.
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
