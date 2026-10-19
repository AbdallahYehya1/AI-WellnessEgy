"""Ingest knowledge documents (markdown with a simple front-matter block).

    python -m app.knowledge.ingest app/knowledge/fixtures

    python -m app.knowledge.ingest app/knowledge/sources    # curated public-health sources

Rules: provenance fields are required; `approved` requires reviewer details;
non-synthetic sources must also record their licence, permitted use, retrieval
date and clinical-review state; documents containing instruction-like text (a
prompt-injection screen) are rejected. Re-ingesting the same slug + version
replaces its chunks. Only curated, hand-checked excerpts with recorded provenance
and licence: never scraped or live web content, patient records or case histories.
"""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.knowledge.models import REVIEW_STATUSES, KnowledgeChunk, KnowledgeSource

CHUNK_TARGET_CHARS = 800
REQUIRED = (
    "slug",
    "title",
    "publisher",
    "source_ref",
    "version_label",
    "content_type",
    "language",
    "age_bands",
    "review_status",
)
_AGE_BANDS = {"child", "teen", "adult"}
# Licence and review provenance every real (non-synthetic) source must declare.
REQUIRED_FOR_REAL_SOURCES = ("licence", "permitted_use", "retrieved_on", "clinical_review")
_INJECTION = re.compile(
    r"ignore (all |any )?(previous|prior|above) instructions|system prompt|you are now|"
    r"disregard (the|your) (rules|instructions)|تجاهل (كل )?التعليمات",
    re.IGNORECASE,
)


class IngestError(ValueError):
    pass


@dataclass(frozen=True)
class ParsedDocument:
    meta: dict[str, str]
    body: str


def parse(text: str) -> ParsedDocument:
    match = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.DOTALL)
    if not match:
        raise IngestError("missing front matter")
    meta = {}
    for line in match.group(1).splitlines():
        if line.strip():
            key, _, value = line.partition(":")
            meta[key.strip()] = value.strip()
    missing = [k for k in REQUIRED if not meta.get(k)]
    if missing:
        raise IngestError(f"missing fields: {', '.join(missing)}")
    if meta["review_status"] not in REVIEW_STATUSES:
        raise IngestError("invalid review_status")
    bands = {b.strip() for b in meta["age_bands"].split(",")}
    if not bands or not bands <= _AGE_BANDS:
        raise IngestError("invalid age_bands")
    if meta["review_status"] == "approved" and not (
        meta.get("reviewed_by") and meta.get("reviewed_at")
    ):
        raise IngestError("approved sources need reviewed_by and reviewed_at")
    if meta["review_status"] in ("draft", "approved"):  # real content
        missing_provenance = [k for k in REQUIRED_FOR_REAL_SOURCES if not meta.get(k)]
        if missing_provenance:
            raise IngestError(f"missing provenance: {', '.join(missing_provenance)}")
        if meta["review_status"] == "approved" and meta["clinical_review"] == "none":
            raise IngestError("approved sources cannot have clinical_review: none")
    body = match.group(2).strip()
    if _INJECTION.search(body):
        raise IngestError("document contains instruction-like text")
    return ParsedDocument(meta=meta, body=body)


def chunk(body: str) -> list[str]:
    chunks: list[str] = []
    current = ""
    for paragraph in (p.strip() for p in body.split("\n\n")):
        if not paragraph:
            continue
        if current and len(current) + len(paragraph) + 2 > CHUNK_TARGET_CHARS:
            chunks.append(current)
            current = paragraph
        else:
            current = f"{current}\n\n{paragraph}" if current else paragraph
    if current:
        chunks.append(current)
    return chunks


def ingest_document(session: Session, doc: ParsedDocument) -> KnowledgeSource:
    meta = doc.meta
    existing = session.execute(
        select(KnowledgeSource).where(
            KnowledgeSource.slug == meta["slug"],
            KnowledgeSource.version_label == meta["version_label"],
        )
    ).scalar_one_or_none()
    source = existing or KnowledgeSource(slug=meta["slug"], version_label=meta["version_label"])
    source.title = meta["title"]
    source.publisher = meta["publisher"]
    source.source_ref = meta["source_ref"]
    source.content_type = meta["content_type"]
    source.language = meta["language"]
    source.age_bands = sorted(b.strip() for b in meta["age_bands"].split(","))
    source.review_status = meta["review_status"]
    source.published_on = (
        date.fromisoformat(meta["published_on"]) if meta.get("published_on") else None
    )
    source.reviewed_by = meta.get("reviewed_by") or None
    source.reviewed_at = (
        datetime.fromisoformat(meta["reviewed_at"]) if meta.get("reviewed_at") else None
    )
    source.expires_at = (
        datetime.fromisoformat(meta["expires_at"]) if meta.get("expires_at") else None
    )
    session.add(source)
    session.flush()
    session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.source_id == source.id))
    for index, content in enumerate(chunk(doc.body)):
        session.add(KnowledgeChunk(source_id=source.id, chunk_index=index, content=content))
    session.flush()
    return source


def ingest_directory(session: Session, directory: Path) -> int:
    count = 0
    for path in sorted(directory.glob("*.md")):
        ingest_document(session, parse(path.read_text(encoding="utf-8")))
        count += 1
    return count


def main() -> None:  # pragma: no cover - thin CLI wrapper
    from app.core.config import Settings
    from app.core.db import session_factory_for

    factory = session_factory_for(Settings())
    if factory is None:
        sys.exit("DATABASE_URL is not set")
    with factory() as session, session.begin():
        print(f"ingested {ingest_directory(session, Path(sys.argv[1]))} documents")


if __name__ == "__main__":  # pragma: no cover
    main()
