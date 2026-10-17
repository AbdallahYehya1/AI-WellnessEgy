"""Chat prototype: knowledge sources/chunks, safety events, chat rate events.

- knowledge_chunks.search_vector is a stored tsvector over the English,
  Arabic and simple configurations, with a GIN index.
- safety_events holds decision metadata only, never message text.
- chat_rate_events backs the PostgreSQL rate limiter (fails closed).
Same posture as 0001/0002: schema `app`, RLS on, Data API roles revoked.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"
TABLES = ("knowledge_sources", "knowledge_chunks", "safety_events", "chat_rate_events")


def upgrade() -> None:
    op.create_table(
        "knowledge_sources",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(120), nullable=False),
        sa.Column("title", sa.String(300), nullable=False),
        sa.Column("publisher", sa.String(200), nullable=False),
        sa.Column("source_ref", sa.String(500), nullable=False),
        sa.Column("version_label", sa.String(50), nullable=False),
        sa.Column("published_on", sa.Date(), nullable=True),
        sa.Column("content_type", sa.String(50), nullable=False),
        sa.Column("language", sa.String(10), nullable=False),
        sa.Column("age_bands", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("review_status", sa.String(20), nullable=False),
        sa.Column("reviewed_by", sa.String(200), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint(
            "review_status IN ('synthetic', 'draft', 'approved', 'withdrawn')",
            name=op.f("ck_knowledge_sources_review_status_valid"),
        ),
        sa.CheckConstraint(
            "cardinality(age_bands) >= 1 AND age_bands <@ ARRAY['child', 'teen', 'adult']",
            name=op.f("ck_knowledge_sources_age_bands_valid"),
        ),
        sa.CheckConstraint(
            "review_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
            name=op.f("ck_knowledge_sources_approved_requires_reviewer"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_knowledge_sources")),
        sa.UniqueConstraint(
            "slug", "version_label", name=op.f("uq_knowledge_sources_slug_version_label")
        ),
        schema=SCHEMA,
    )
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed(
                "to_tsvector('english'::regconfig, content) || "
                "to_tsvector('arabic'::regconfig, content) || "
                "to_tsvector('simple'::regconfig, content)",
                persisted=True,
            ),
            nullable=True,
        ),
        sa.CheckConstraint(
            "char_length(content) BETWEEN 1 AND 4000",
            name=op.f("ck_knowledge_chunks_content_length"),
        ),
        sa.ForeignKeyConstraint(
            ["source_id"],
            [f"{SCHEMA}.knowledge_sources.id"],
            name=op.f("fk_knowledge_chunks_source_id_knowledge_sources"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_knowledge_chunks")),
        sa.UniqueConstraint(
            "source_id", "chunk_index", name=op.f("uq_knowledge_chunks_source_id_chunk_index")
        ),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_knowledge_chunks_search",
        "knowledge_chunks",
        ["search_vector"],
        schema=SCHEMA,
        postgresql_using="gin",
    )
    op.create_table(
        "safety_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("request_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("age_band", sa.String(10), nullable=False),
        sa.Column("risk_level", sa.String(10), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("final_status", sa.String(20), nullable=False),
        sa.Column("policy_version", sa.String(50), nullable=False),
        sa.Column("reason_code", sa.String(50), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_safety_events_actor_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_safety_events")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_safety_events_actor_created",
        "safety_events",
        ["actor_user_id", "created_at"],
        schema=SCHEMA,
    )
    op.create_table(
        "chat_rate_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.clock_timestamp(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            [f"{SCHEMA}.users.id"],
            name=op.f("fk_chat_rate_events_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_rate_events")),
        schema=SCHEMA,
    )
    op.create_index(
        "ix_chat_rate_events_user_created",
        "chat_rate_events",
        ["user_id", "created_at"],
        schema=SCHEMA,
    )

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
                    EXECUTE format('REVOKE ALL ON app.knowledge_sources, app.knowledge_chunks,
                        app.safety_events, app.chat_rate_events FROM %I', role_name);
                    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM %I', role_name);
                END IF;
            END LOOP;
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_chat_rate_events_user_created", table_name="chat_rate_events", schema=SCHEMA)
    op.drop_table("chat_rate_events", schema=SCHEMA)
    op.drop_index("ix_safety_events_actor_created", table_name="safety_events", schema=SCHEMA)
    op.drop_table("safety_events", schema=SCHEMA)
    op.drop_index("ix_knowledge_chunks_search", table_name="knowledge_chunks", schema=SCHEMA)
    op.drop_table("knowledge_chunks", schema=SCHEMA)
    op.drop_table("knowledge_sources", schema=SCHEMA)
