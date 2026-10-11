"""Metadata-only safety events. Message text is never stored here."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class SafetyEvent(Base):
    __tablename__ = "safety_events"
    __table_args__ = (Index("ix_safety_events_actor_created", "actor_user_id", "created_at"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    request_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    age_band: Mapped[str] = mapped_column(String(10))
    risk_level: Mapped[str] = mapped_column(String(10))
    outcome: Mapped[str] = mapped_column(String(20))  # the safety decision
    final_status: Mapped[str] = mapped_column(String(20))  # what the user got
    policy_version: Mapped[str] = mapped_column(String(50))
    reason_code: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
