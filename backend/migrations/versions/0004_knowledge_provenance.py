"""Knowledge provenance: licence, review states kept apart, content hashes.

- knowledge_sources gains licence, permitted_use, retrieved_on, source_verified
  (engineering checked publisher, URL and text), clinical_review ("none" until a
  qualified reviewer signs off) and content_sha256 (deterministic re-imports).
  An approved source can no longer carry clinical_review = 'none'.
- knowledge_chunks gains section (the passage's heading) and content_sha256, unique
  per source, so a re-import cannot duplicate a passage.
Additive only: no existing row is changed beyond the new columns' defaults.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-19
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SCHEMA = "app"


def upgrade() -> None:
    op.add_column("knowledge_sources", sa.Column("licence", sa.String(300)), schema=SCHEMA)
    op.add_column("knowledge_sources", sa.Column("permitted_use", sa.String(500)), schema=SCHEMA)
    op.add_column("knowledge_sources", sa.Column("retrieved_on", sa.Date()), schema=SCHEMA)
    op.add_column(
        "knowledge_sources",
        sa.Column("source_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
        schema=SCHEMA,
    )
    op.add_column(
        "knowledge_sources",
        sa.Column("clinical_review", sa.String(200), nullable=False, server_default="none"),
        schema=SCHEMA,
    )
    op.add_column("knowledge_sources", sa.Column("content_sha256", sa.String(64)), schema=SCHEMA)
    op.create_check_constraint(
        op.f("ck_knowledge_sources_approved_requires_clinical_review"),
        "knowledge_sources",
        "review_status <> 'approved' OR clinical_review <> 'none'",
        schema=SCHEMA,
    )
    op.add_column("knowledge_chunks", sa.Column("section", sa.String(200)), schema=SCHEMA)
    op.add_column("knowledge_chunks", sa.Column("content_sha256", sa.String(64)), schema=SCHEMA)
    op.create_unique_constraint(
        op.f("uq_knowledge_chunks_source_id_content_sha256"),
        "knowledge_chunks",
        ["source_id", "content_sha256"],
        schema=SCHEMA,
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("uq_knowledge_chunks_source_id_content_sha256"), "knowledge_chunks", schema=SCHEMA
    )
    op.drop_column("knowledge_chunks", "content_sha256", schema=SCHEMA)
    op.drop_column("knowledge_chunks", "section", schema=SCHEMA)
    op.drop_constraint(
        op.f("ck_knowledge_sources_approved_requires_clinical_review"),
        "knowledge_sources",
        schema=SCHEMA,
    )
    for column in (
        "content_sha256",
        "clinical_review",
        "source_verified",
        "retrieved_on",
        "permitted_use",
        "licence",
    ):
        op.drop_column("knowledge_sources", column, schema=SCHEMA)
