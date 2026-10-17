"""Approved, age-applicable retrieval with PostgreSQL full-text search.

Matching is OR-based across the English, Arabic and `simple` (for Arabizi)
configurations. Filters are applied in SQL, so unapproved, withdrawn,
expired or other-age-band content can never be returned.
Known limitation: stemming handles Egyptian Arabic dialect and Arabizi
poorly; retrieval quality must be evaluated before relying on it (D-7).
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.orm import Session

MAX_PASSAGES = 4
_TOKEN = re.compile(r"\w{3,}", re.UNICODE)
_SIMPLE_STOPWORDS = frozenset(
    {"the", "and", "how", "can", "you", "what", "for", "with", "this", "that", "are", "ana", "enta"}
)

_SQL = text(
    """
    SELECT c.id, c.content, s.title, s.publisher, s.source_ref, s.version_label,
           s.review_status
    FROM app.knowledge_chunks c
    JOIN app.knowledge_sources s ON s.id = c.source_id,
         LATERAL (
           SELECT replace(plainto_tsquery('english', :q)::text, '&', '|')::tsquery
               || replace(plainto_tsquery('arabic', :q)::text, '&', '|')::tsquery
               || to_tsquery('simple', :simple_q) AS query
         ) q
    WHERE c.search_vector @@ q.query
      AND CAST(:band AS text) = ANY (s.age_bands)
      AND s.review_status = ANY (CAST(:statuses AS text[]))
      AND (s.expires_at IS NULL OR s.expires_at > now())
    ORDER BY ts_rank_cd(c.search_vector, q.query) DESC, c.id
    LIMIT :limit
    """
)


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: uuid.UUID
    content: str
    title: str
    publisher: str
    source_ref: str
    version_label: str
    synthetic: bool


def _simple_query(message: str) -> str:
    tokens = {t.lower() for t in _TOKEN.findall(message)} - _SIMPLE_STOPWORDS
    # Tokens are word characters only, so quoting them is injection-safe.
    return " | ".join(f"'{t}'" for t in sorted(tokens)) or "''"


def retrieve(
    session: Session, message: str, age_band: str, statuses: tuple[str, ...]
) -> list[RetrievedChunk]:
    rows = session.execute(
        _SQL,
        {
            "q": message,
            "simple_q": _simple_query(message),
            "band": age_band,
            "statuses": list(statuses),
            "limit": MAX_PASSAGES,
        },
    ).all()
    return [
        RetrievedChunk(
            chunk_id=row.id,
            content=row.content,
            title=row.title,
            publisher=row.publisher,
            source_ref=row.source_ref,
            version_label=row.version_label,
            synthetic=row.review_status == "synthetic",
        )
        for row in rows
    ]
