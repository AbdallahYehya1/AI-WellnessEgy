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

import hashlib
import re
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import delete, func, select
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


_SECTION = re.compile(r"^([^.\n]{1,160}\))\.\s")  # "Grounding (WHO, ...). " headings
_CRLF = chr(13) + chr(10)


def _sha256(text: str) -> str:
    return hashlib.sha256(text.replace(_CRLF, chr(10)).strip().encode("utf-8")).hexdigest()


def _section(content: str) -> str | None:
    match = _SECTION.match(content)
    return match.group(1)[:200] if match else None


@dataclass(frozen=True)
class IngestResult:
    slug: str
    version_label: str
    status: str  # "new" | "updated" | "unchanged"
    chunks: int
    content_sha256: str


def ingest_document(session: Session, doc: ParsedDocument) -> KnowledgeSource:
    return ingest_document_result(session, doc)[0]


def ingest_document_result(
    session: Session, doc: ParsedDocument
) -> tuple[KnowledgeSource, IngestResult]:
    """Deterministic, repeatable import: an unchanged document (same content hash)
    keeps its chunks; a changed one is re-chunked; identical passages are stored once."""
    meta = doc.meta
    body_hash = _sha256(doc.body)
    existing = session.execute(
        select(KnowledgeSource).where(
            KnowledgeSource.slug == meta["slug"],
            KnowledgeSource.version_label == meta["version_label"],
        )
    ).scalar_one_or_none()
    status = (
        "new"
        if existing is None
        else ("unchanged" if existing.content_sha256 == body_hash else "updated")
    )
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
    source.licence = meta.get("licence") or None
    source.permitted_use = meta.get("permitted_use") or None
    source.retrieved_on = (
        date.fromisoformat(meta["retrieved_on"]) if meta.get("retrieved_on") else None
    )
    source.source_verified = meta.get("source_verified", "").lower() == "true"
    source.clinical_review = meta.get("clinical_review") or "none"
    source.content_sha256 = body_hash
    session.add(source)
    session.flush()
    if status != "unchanged":
        session.execute(delete(KnowledgeChunk).where(KnowledgeChunk.source_id == source.id))
        seen: set[str] = set()
        index = 0
        for content in chunk(doc.body):
            digest = _sha256(content)
            if digest in seen:  # the same passage twice in one document: keep one
                continue
            seen.add(digest)
            session.add(
                KnowledgeChunk(
                    source_id=source.id,
                    chunk_index=index,
                    content=content,
                    section=_section(content),
                    content_sha256=digest,
                )
            )
            index += 1
        session.flush()
    count = session.execute(
        select(func.count())
        .select_from(KnowledgeChunk)
        .where(KnowledgeChunk.source_id == source.id)
    ).scalar_one()
    return source, IngestResult(meta["slug"], meta["version_label"], status, int(count), body_hash)


def ingest_directory_report(session: Session, directory: Path) -> list[IngestResult]:
    return [
        ingest_document_result(session, parse(path.read_text(encoding="utf-8")))[1]
        for path in sorted(directory.glob("*.md"))
    ]


def ingest_directory(session: Session, directory: Path) -> int:
    return len(ingest_directory_report(session, directory))


def main() -> None:  # pragma: no cover - thin CLI wrapper
    from app.core.config import Settings
    from app.core.db import session_factory_for

    factory = session_factory_for(Settings())
    if factory is None:
        sys.exit("DATABASE_URL is not set")
    with factory() as session, session.begin():
        results = ingest_directory_report(session, Path(sys.argv[1]))
        for r in results:
            digest = r.content_sha256[:12]
            print(f"{r.status:9} {r.slug} {r.version_label}: {r.chunks} chunks, sha256 {digest}")
        print(f"ingested {len(results)} documents")


if __name__ == "__main__":  # pragma: no cover
    main()
