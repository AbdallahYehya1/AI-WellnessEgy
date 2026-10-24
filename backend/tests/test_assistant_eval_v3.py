"""Ten-assistant retrieval (D-61) against pre-registered thresholds.

v3 was used for tuning; v4 was written after tuning and before its first run. Both are
reported; both must meet the thresholds fixed before v3 was first run.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.assistants.eval_v3 import HELD_OUT_V3, THRESHOLDS
from app.assistants.eval_v4 import HELD_OUT_V4
from app.assistants.evaluation import evaluate
from app.assistants.registry import DOMAINS
from app.knowledge.ingest import ingest_directory

SOURCES = Path(__file__).resolve().parents[1] / "app" / "knowledge" / "sources"
REPORT = Path(__file__).resolve().parents[2] / "docs" / "evaluation" / "assistant-retrieval-v3.json"
MODES = ("baseline", "monolithic", "domain", "hybrid")


def _arabic(results: list[dict[str, Any]], mode: str) -> float:
    rows = [r for r in results if r["language"] in ("ar", "arz", "mixed")]
    return round(sum(bool(r[mode]["hit"]) for r in rows) / len(rows), 3)


def _show(name: str, report: dict[str, Any]) -> dict[str, float]:
    arabic = {m: _arabic(report["results"], m) for m in ("domain", "hybrid")}
    print(name, "ALL", json.dumps(report["summary"]["all"]), "ARABIC", arabic)
    for d in DOMAINS:
        print(name, d, json.dumps({m: report["summary"][d][m]["hit_at_4"] for m in MODES}))
    for row in report["results"]:
        if not row["domain"]["hit"] or not row["hybrid"]["hit"]:
            case = {k: row[k] for k in ("case", "understood", "subtopics")}
            print(
                f"MISS_{name}",
                json.dumps(case, ensure_ascii=False),
                "domain",
                row["domain"]["found"][:2],
                "hybrid",
                row["hybrid"]["found"][:2],
            )
    return arabic


def _failures(report: dict[str, Any], arabic: dict[str, float], mode: str) -> list[Any]:
    summary = report["summary"]
    out: list[Any] = [
        (d, summary[d][mode])
        for d in DOMAINS
        if summary[d][mode]["hit_at_4"] < THRESHOLDS["per_assistant_hit_at_4"]
        or summary[d][mode]["leakage"] > THRESHOLDS["per_assistant_leakage"]
    ]
    if arabic[mode] < THRESHOLDS["arabic_hit_at_4"]:
        out.append(("arabic", arabic[mode]))
    return out


def test_ten_assistants_meet_the_preregistered_thresholds(db_engine: Engine) -> None:
    with Session(db_engine) as session, session.begin():
        ingest_directory(session, SOURCES)
        tuned = evaluate(session, cases=HELD_OUT_V3)
        fresh = evaluate(session, cases=HELD_OUT_V4)
    tuned_arabic = _show("V3", tuned)
    fresh_arabic = _show("V4", fresh)
    if REPORT.parent.is_dir():
        REPORT.write_text(
            json.dumps(
                {
                    "thresholds": THRESHOLDS,
                    "v3_tuned": {"arabic_hit_at_4": tuned_arabic, **tuned},
                    "v4_held_out": {"arabic_hit_at_4": fresh_arabic, **fresh},
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
    # Production retrieval for assistants is hybrid (D-61); it must meet the thresholds.
    assert not _failures(tuned, tuned_arabic, "hybrid")
    assert not _failures(fresh, fresh_arabic, "hybrid")
