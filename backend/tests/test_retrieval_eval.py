"""Retrieval quality over the curated sources (engineering metric, not clinical)."""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.knowledge.evaluation import HELD_OUT, evaluate
from app.knowledge.ingest import ingest_directory

SOURCES = Path(__file__).resolve().parents[1] / "app" / "knowledge" / "sources"


def test_report_retrieval_quality(db_engine: Engine) -> None:
    with Session(db_engine) as session, session.begin():
        assert ingest_directory(session, SOURCES) == 4
        report = evaluate(session)
        held_out = evaluate(session, cases=HELD_OUT)
    for name, rep in (("tuned", report), ("held_out", held_out)):
        print(
            name, json.dumps({k: v for k, v in rep.items() if k != "results"}, ensure_ascii=False)
        )
    for r in held_out["results"]:  # type: ignore[attr-defined]
        print(json.dumps(r, ensure_ascii=False))
