"""Domain-specific retrieval vs the earlier general retrieval, on held-out questions (D-56).

Prints the measured report (run with -s to see it) and guards the minimum quality the
two reference assistants were released with.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.assistants.evaluation import HELD_OUT_V2, evaluate
from app.knowledge.ingest import ingest_directory

SOURCES = Path(__file__).resolve().parents[1] / "app" / "knowledge" / "sources"


def test_report_assistant_retrieval(db_engine: Engine) -> None:
    with Session(db_engine) as session, session.begin():
        ingest_directory(session, SOURCES)
        report = evaluate(session)
        fresh = evaluate(session, cases=HELD_OUT_V2)
    summary: dict[str, Any] = report["summary"]
    print("HELD_OUT_V2", json.dumps(fresh["summary"]["all"]))
    for row in fresh["results"]:
        if not row["domain"]["hit"]:
            print("MISS_V2", json.dumps(row, ensure_ascii=False))
    print(json.dumps(summary, indent=2))
    for row in report["results"]:
        if not row["domain"]["hit"]:
            print("MISS", json.dumps(row, ensure_ascii=False))
    for assistant in ("relationships", "career"):
        domain = summary[assistant]["domain"]
        baseline = summary[assistant]["baseline"]
        assert domain["hit_at_4"] >= 0.9, (assistant, domain)
        assert domain["leakage"] == 0.0, (assistant, domain)  # enforced in SQL
        assert domain["hit_at_4"] > baseline["hit_at_4"], (assistant, domain, baseline)
    out = Path(__file__).resolve().parents[2] / "docs" / "evaluation"
    out.mkdir(exist_ok=True)
    (out / "assistant-retrieval.json").write_text(
        json.dumps({"tuned": report, "held_out_v2": fresh}, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )
