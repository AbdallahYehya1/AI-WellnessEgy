"""Knowledge sources and chunks (docs/DATA_MODEL.md, knowledge_*).

Every source carries provenance and a review status. Only `approved`
sources may be retrieved in production; `synthetic` fixtures are retrievable
only under the test-only safety policy and are never clinical evidence.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, TSVECTOR, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.assistants.registry import DOMAINS
from app.core.db import Base

DOMAIN_ARRAY_SQL = "ARRAY[" + ", ".join(f"'{d}'" for d in DOMAINS) + "]::text[]"

REVIEW_STATUSES = ("synthetic", "draft", "approved", "withdrawn")
SEARCH_VECTOR_SQL = (
    "to_tsvector('english'::regconfig, content) || "
    "to_tsvector('arabic'::regconfig, content) || "
    "to_tsvector('simple'::regconfig, content)"
)


class KnowledgeSource(Base):
    __tablename__ = "knowledge_sources"
    __table_args__ = (
        UniqueConstraint("slug", "version_label"),
        CheckConstraint(
            "review_status IN ('synthetic', 'draft', 'approved', 'withdrawn')",
            name="review_status_valid",
        ),
        CheckConstraint(
            "cardinality(age_bands) >= 1 AND age_bands <@ ARRAY['child', 'teen', 'adult']",
            name="age_bands_valid",
        ),
        CheckConstraint(
            "review_status <> 'approved' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)",
            name="approved_requires_reviewer",
        ),
        CheckConstraint(
            "review_status <> 'approved' OR clinical_review <> 'none'",
            name="approved_requires_clinical_review",
        ),
        CheckConstraint(f"domains <@ {DOMAIN_ARRAY_SQL}", name="domains_valid"),
        Index("ix_knowledge_sources_domains", "domains", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(120))
    title: Mapped[str] = mapped_column(String(300))
    publisher: Mapped[str] = mapped_column(String(200))
    source_ref: Mapped[str] = mapped_column(String(500))  # URL or identifier
    version_label: Mapped[str] = mapped_column(String(50))
    published_on: Mapped[date | None] = mapped_column(Date)
    content_type: Mapped[str] = mapped_column(String(50))
    language: Mapped[str] = mapped_column(String(10))
    age_bands: Mapped[list[str]] = mapped_column(ARRAY(Text))
    review_status: Mapped[str] = mapped_column(String(20))
    reviewed_by: Mapped[str | None] = mapped_column(String(200))
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # Provenance (0004). Three different things, never interchangeable:
    # source_verified = engineering checked publisher, URL and text;
    # permitted_use/licence = what this prototype may do with it;
    # clinical_review = a qualified reviewer's decision ("none" until then).
    licence: Mapped[str | None] = mapped_column(String(300))
    permitted_use: Mapped[str | None] = mapped_column(String(500))
    retrieved_on: Mapped[date | None] = mapped_column(Date)
    source_verified: Mapped[bool] = mapped_column(Boolean, server_default=false())
    clinical_review: Mapped[str] = mapped_column(String(200), server_default="none")
    content_sha256: Mapped[str | None] = mapped_column(String(64))
    # Assistant domains this source may be retrieved for (D-56), enforced in SQL.
    domains: Mapped[list[str]] = mapped_column(ARRAY(Text), default=list, server_default="{}")


class KnowledgeChunk(Base):
    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        UniqueConstraint("source_id", "chunk_index"),
        UniqueConstraint("source_id", "content_sha256"),
        CheckConstraint("char_length(content) BETWEEN 1 AND 4000", name="content_length"),
        Index("ix_knowledge_chunks_search", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("knowledge_sources.id", ondelete="CASCADE")
    )
    chunk_index: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR, Computed(SEARCH_VECTOR_SQL, persisted=True)
    )
    section: Mapped[str | None] = mapped_column(String(200))  # the passage's heading
    content_sha256: Mapped[str | None] = mapped_column(String(64))
