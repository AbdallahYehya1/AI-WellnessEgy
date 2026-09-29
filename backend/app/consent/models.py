"""Consent records (docs/DATA_MODEL.md, `consents`).

Each row records one explicit decision by a user on one published consent
version. Rows are never updated to point at a newer version: accepting a new
version always creates a new row.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Consent(Base):
    __tablename__ = "consents"
    __table_args__ = (
        CheckConstraint("consent_type IN ('required', 'optional')", name="consent_type_valid"),
        CheckConstraint(
            "withdrawn_at IS NULL OR consent_type = 'optional'",
            name="withdrawal_only_for_optional",
        ),
        Index("ix_consents_user_type_recorded", "user_id", "consent_type", "recorded_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    version: Mapped[str] = mapped_column(String(64))
    consent_type: Mapped[str] = mapped_column(String(16))
    granted: Mapped[bool] = mapped_column(Boolean)
    # clock_timestamp(), not now(): distinct times even within one transaction.
    recorded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    withdrawn_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
