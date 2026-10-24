"""Specialised assistants (D-56) and Daily Reflection (D-57).

Assistants:
- knowledge_sources.domains: the assistant domains a source may be retrieved for (GIN
  index; retrieval filters on it in SQL). Existing sources are backfilled.
- chat_conversations.assistant_id: which assistant a saved conversation belongs to.
  Existing conversations keep working as Emotional Wellbeing (their original topic).
- chat_messages.query_enc: the encrypted re-expressed question the model was asked, so a
  saved conversation can continue without sending the user's own words.

Daily Reflection:
- mood_checkins gains emotions (1-9 labels), factors (0-11 labels), note_enc (a private
  note, encrypted by the backend) and entry_version. Version 1 rows are the existing 1-5
  check-ins and stay exactly as they are; version 2 rows are reflections and have no
  numeric score. Old scores are never reinterpreted as emotions.

Additive, apart from mood_score becoming nullable (version 2 rows only). Downgrading
deletes version 2 reflections, which cannot be represented in 0005.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-23
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
DOMAINS = (
    "relationships",
    "family",
    "career",
    "growth",
    "fitness",
    "emotional",
    "social",
    "planning",
    "finance",
    "everyday",
)
_DOMAIN_ARRAY = "ARRAY[" + ", ".join(f"'{d}'" for d in DOMAINS) + "]::text[]"
# Existing curated sources: everything was emotional wellbeing; activity and sleep pages
# also serve the fitness assistant.
BACKFILL = {
    "cdc-physical-activity-benefits-en": ["fitness", "emotional"],
    "cdc-about-sleep-en": ["emotional", "fitness"],
    "nimh-caring-for-your-mental-health-en": ["emotional", "growth"],
}


def upgrade() -> None:
    op.add_column(
        "knowledge_sources",
        sa.Column("domains", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_knowledge_sources_domains_valid"),
        "knowledge_sources",
        f"domains <@ {_DOMAIN_ARRAY}",
        schema=SCHEMA,
    )
    op.create_index(
        "ix_knowledge_sources_domains",
        "knowledge_sources",
        ["domains"],
        schema=SCHEMA,
        postgresql_using="gin",
    )
    op.execute("UPDATE app.knowledge_sources SET domains = ARRAY['emotional']")
    for slug, domains in BACKFILL.items():
        op.execute(
            sa.text("UPDATE app.knowledge_sources SET domains = :d WHERE slug = :s").bindparams(
                sa.bindparam("d", domains, type_=postgresql.ARRAY(sa.Text())), s=slug
            )
        )

    op.add_column(
        "chat_conversations",
        sa.Column("assistant_id", sa.String(40), server_default="emotional", nullable=False),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chat_conversations_user_assistant_activity",
        "chat_conversations",
        ["user_id", "assistant_id", "last_activity_at"],
        schema=SCHEMA,
    )
    op.add_column("chat_messages", sa.Column("query_enc", sa.Text()), schema=SCHEMA)

    op.alter_column("mood_checkins", "mood_score", nullable=True, schema=SCHEMA)
    op.drop_constraint(op.f("ck_mood_checkins_mood_score_range"), "mood_checkins", schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_mood_checkins_mood_score_range"),
        "mood_checkins",
        "mood_score IS NULL OR mood_score BETWEEN 1 AND 5",
        schema=SCHEMA,
    )
    op.add_column(
        "mood_checkins",
        sa.Column("emotions", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        schema=SCHEMA,
    )
    op.add_column(
        "mood_checkins",
        sa.Column("factors", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False),
        schema=SCHEMA,
    )
    op.add_column("mood_checkins", sa.Column("note_enc", sa.Text()), schema=SCHEMA)
    op.add_column(
        "mood_checkins",
        sa.Column("entry_version", sa.SmallInteger(), server_default="1", nullable=False),
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_mood_checkins_entry_valid"),
        "mood_checkins",
        "(entry_version = 1 AND mood_score IS NOT NULL) OR "
        "(entry_version = 2 AND mood_score IS NULL AND cardinality(emotions) BETWEEN 1 AND 9)",
        schema=SCHEMA,
    )
    op.create_check_constraint(
        op.f("ck_mood_checkins_factors_count"),
        "mood_checkins",
        "cardinality(factors) <= 11",
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.execute("DELETE FROM app.mood_checkins WHERE entry_version = 2")
    op.drop_constraint(op.f("ck_mood_checkins_factors_count"), "mood_checkins", schema=SCHEMA)
    op.drop_constraint(op.f("ck_mood_checkins_entry_valid"), "mood_checkins", schema=SCHEMA)
    for column in ("entry_version", "note_enc", "factors", "emotions"):
        op.drop_column("mood_checkins", column, schema=SCHEMA)
    op.drop_constraint(op.f("ck_mood_checkins_mood_score_range"), "mood_checkins", schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_mood_checkins_mood_score_range"),
        "mood_checkins",
        "mood_score BETWEEN 1 AND 5",
        schema=SCHEMA,
    )
    op.alter_column("mood_checkins", "mood_score", nullable=False, schema=SCHEMA)
    op.drop_column("chat_messages", "query_enc", schema=SCHEMA)
    op.drop_index(
        "ix_chat_conversations_user_assistant_activity",
        table_name="chat_conversations",
        schema=SCHEMA,
    )
    op.drop_column("chat_conversations", "assistant_id", schema=SCHEMA)
    op.drop_index("ix_knowledge_sources_domains", table_name="knowledge_sources", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_knowledge_sources_domains_valid"), "knowledge_sources", schema=SCHEMA
    )
    op.drop_column("knowledge_sources", "domains", schema=SCHEMA)
