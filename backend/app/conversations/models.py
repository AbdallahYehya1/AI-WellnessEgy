"""Saved chat history (opt-in, OPEN_DECISIONS D-54). Bodies and titles are ciphertext.

Stored per message: the user's text or the reply (encrypted), the recognised topic of a
user question, validated citation metadata (public source titles and URLs) and the model
name. Never stored: retrieved passages, prompts, raw provider responses, safety
diagnostics, or refused messages.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class ChatConversation(Base):
    __tablename__ = "chat_conversations"
    __table_args__ = (
        Index("ix_chat_conversations_user_activity", "user_id", "last_activity_at", "id"),
        Index(
            "ix_chat_conversations_user_assistant_activity",
            "user_id",
            "assistant_id",
            "last_activity_at",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    title_enc: Mapped[str] = mapped_column(Text)
    # Which assistant this conversation belongs to (D-56); older chats are "emotional".
    assistant_id: Mapped[str] = mapped_column(String(40), server_default="emotional")
    message_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
    last_activity_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_chat_messages_conversation_id_seq"),
        UniqueConstraint(
            "conversation_id",
            "client_message_id",
            "role",
            name="uq_chat_messages_conversation_id_client_message_id_role",
        ),
        CheckConstraint("role IN ('user', 'assistant')", name="role_valid"),
        CheckConstraint("language IN ('en', 'ar')", name="language_valid"),
        Index("ix_chat_messages_user_id", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chat_conversations.id", ondelete="CASCADE")
    )
    # Owner, repeated so every message query can be filtered by the verified user.
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE")
    )
    seq: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(10))
    content_enc: Mapped[str] = mapped_column(Text)
    # Encrypted re-expressed question the model was asked (user turns, assistant mode).
    query_enc: Mapped[str | None] = mapped_column(Text)
    intent_id: Mapped[str | None] = mapped_column(String(40))  # recognised topic (user turns)
    language: Mapped[str] = mapped_column(String(2))
    citations: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default="[]"
    )
    model: Mapped[str | None] = mapped_column(String(80))
    client_message_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.clock_timestamp()
    )
