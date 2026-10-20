"""Opt-in saved chat history (OPEN_DECISIONS D-54).

- users gains chat_history_enabled (default false), chat_history_consent_version and
  chat_history_consented_at: nothing is saved until a user explicitly opts in.
- chat_conversations: one row per saved conversation, title encrypted by the backend.
- chat_messages: encrypted message bodies with order (seq), the recognised topic of a
  user question, validated citation metadata and the model name. Retrieved passages,
  prompts, raw provider responses and refused messages are never stored.
- Deleting a conversation (or a user) removes its messages (ON DELETE CASCADE).
Same posture as 0001-0004: schema `app`, RLS on with no policies, Data API roles revoked.
Additive only: existing rows keep their data; every user starts with history off.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-20
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
TABLES = ("chat_conversations", "chat_messages")


def _timestamp(name: str) -> sa.Column[object]:
    return sa.Column(
        name, sa.DateTime(timezone=True), server_default=sa.func.clock_timestamp(), nullable=False
    )


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("chat_history_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
        schema=SCHEMA,
    )
    op.add_column("users", sa.Column("chat_history_consent_version", sa.String(40)), schema=SCHEMA)
    op.add_column(
        "users",
        sa.Column("chat_history_consented_at", sa.DateTime(timezone=True)),
        schema=SCHEMA,
    )

    op.create_table(
        "chat_conversations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("title_enc", sa.Text(), nullable=False),
        sa.Column("message_count", sa.Integer(), server_default="0", nullable=False),
        _timestamp("created_at"),
        _timestamp("updated_at"),
        _timestamp("last_activity_at"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_chat_conversations_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_conversations")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chat_conversations_user_activity",
        "chat_conversations",
        ["user_id", "last_activity_at", "id"],
        schema=SCHEMA,
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("conversation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content_enc", sa.Text(), nullable=False),
        sa.Column("intent_id", sa.String(40)),
        sa.Column("language", sa.String(2), nullable=False),
        sa.Column(
            "citations",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default="[]",
            nullable=False,
        ),
        sa.Column("model", sa.String(80)),
        sa.Column("client_message_id", postgresql.UUID(as_uuid=True)),
        _timestamp("created_at"),
        sa.CheckConstraint(
            "role IN ('user', 'assistant')", name=op.f("ck_chat_messages_role_valid")
        ),
        sa.CheckConstraint(
            "language IN ('en', 'ar')", name=op.f("ck_chat_messages_language_valid")
        ),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            [f"{SCHEMA}.chat_conversations.id"],
            name=op.f("fk_chat_messages_conversation_id_chat_conversations"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_chat_messages_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_messages")),
        sa.UniqueConstraint(
            "conversation_id", "seq", name=op.f("uq_chat_messages_conversation_id_seq")
        ),
        sa.UniqueConstraint(
            "conversation_id",
            "client_message_id",
            "role",
            name=op.f("uq_chat_messages_conversation_id_client_message_id_role"),
        ),
        schema=SCHEMA,
    )
    op.create_index("ix_chat_messages_user_id", "chat_messages", ["user_id"], schema=SCHEMA)

    for table in TABLES:
        op.execute(f"ALTER TABLE {SCHEMA}.{table} ENABLE ROW LEVEL SECURITY")
    # Written without interpolation: table and role names are fixed.
    op.execute(
        """
        DO $$
        DECLARE role_name text;
        BEGIN
            FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
                    EXECUTE format('REVOKE ALL ON app.chat_conversations, app.chat_messages
                        FROM %I', role_name);
                END IF;
            END LOOP;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_chat_messages_user_id", table_name="chat_messages", schema=SCHEMA)
    op.drop_table("chat_messages", schema=SCHEMA)
    op.drop_index(
        "ix_chat_conversations_user_activity", table_name="chat_conversations", schema=SCHEMA
    )
    op.drop_table("chat_conversations", schema=SCHEMA)
    op.drop_column("users", "chat_history_consented_at", schema=SCHEMA)
    op.drop_column("users", "chat_history_consent_version", schema=SCHEMA)
    op.drop_column("users", "chat_history_enabled", schema=SCHEMA)
