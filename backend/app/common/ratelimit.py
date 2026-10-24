"""Per-user rate limiting in PostgreSQL (OPEN_DECISIONS D-21/D-38).

Callers must treat any exception as "not permitted": the chat pipeline fails
closed and does not generate when the limiter cannot decide.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    delete,
    func,
    select,
    text,
    update,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, Session, mapped_column

from app.core.db import Base
from app.users.models import User

WINDOW_SECONDS = 60  # keep in sync with the interval literal below


class ChatRateEvent(Base):
    __tablename__ = "chat_rate_events"
    __table_args__ = (
        Index("ix_chat_rate_events_user_created", "user_id", "created_at"),
        CheckConstraint("tokens IS NULL OR tokens >= 0", name="tokens_nonnegative"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    # Provider tokens this request used (D-59), for the shared daily token budget.
    tokens: Mapped[int | None] = mapped_column(Integer)


def tokens_last_day(session: Session) -> int:
    """Provider tokens used by all users in the last 24 hours (shared budget guard)."""
    used = session.execute(
        select(func.coalesce(func.sum(ChatRateEvent.tokens), 0)).where(
            ChatRateEvent.created_at > func.clock_timestamp() - text("interval '1 day'")
        )
    ).scalar_one()
    return int(used or 0)


def record_tokens(session: Session, user_id: uuid.UUID, tokens: int) -> None:
    """Attach the provider's token count to this user's latest unaccounted request."""
    latest = (
        select(ChatRateEvent.id)
        .where(ChatRateEvent.user_id == user_id, ChatRateEvent.tokens.is_(None))
        .order_by(ChatRateEvent.created_at.desc())
        .limit(1)
        .scalar_subquery()
    )
    session.execute(
        update(ChatRateEvent).where(ChatRateEvent.id == latest).values(tokens=max(0, tokens))
    )


def requests_last_day(session: Session) -> int:
    """Chat requests by all users in the last 24 hours (a shared-quota guard)."""
    return int(
        session.execute(
            select(func.count())
            .select_from(ChatRateEvent)
            .where(ChatRateEvent.created_at > func.clock_timestamp() - text("interval '1 day'"))
        ).scalar_one()
    )


def user_requests_last_day(session: Session, user_id: uuid.UUID) -> int:
    """This user's chat requests in the last 24 hours (fair use of the shared quota)."""
    return int(
        session.execute(
            select(func.count())
            .select_from(ChatRateEvent)
            .where(
                ChatRateEvent.user_id == user_id,
                ChatRateEvent.created_at > func.clock_timestamp() - text("interval '1 day'"),
            )
        ).scalar_one()
    )


def allow_request(session: Session, user_id: uuid.UUID, limit_per_minute: int) -> bool:
    """Record one request and return whether it is within the limit."""
    # Serialise concurrent requests from the same user.
    session.execute(select(User.id).where(User.id == user_id).with_for_update())
    recent = session.execute(
        select(func.count())
        .select_from(ChatRateEvent)
        .where(
            ChatRateEvent.user_id == user_id,
            ChatRateEvent.created_at > func.clock_timestamp() - text("interval '60 seconds'"),
        )
    ).scalar_one()
    if recent >= limit_per_minute:
        return False
    session.add(ChatRateEvent(user_id=user_id))
    session.execute(
        delete(ChatRateEvent).where(
            ChatRateEvent.user_id == user_id,
            ChatRateEvent.created_at < func.clock_timestamp() - text("interval '1 day'"),
        )
    )
    session.flush()
    return True
