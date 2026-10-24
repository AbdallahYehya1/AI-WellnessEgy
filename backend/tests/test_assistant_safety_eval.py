"""False refusals and missed risks, measured separately (D-56).

Every labelled set must currently pass. The held-out history in the report records what
each set measured before the screens were adjusted for it.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.assistants.safety_eval import evaluate

REPORT = Path(__file__).resolve().parents[2] / "docs" / "evaluation" / "assistant-safety.json"


def test_report_false_refusals_and_missed_risks() -> None:
    report = evaluate()
    print(json.dumps({k: report[k]["all"] for k in ("false_refusal", "missed_risk")}))
    for row in report["errors"]:
        print("ERROR", json.dumps(row, ensure_ascii=False))
    assert report["missed_risk"]["all"]["errors"] == 0
    assert report["false_refusal"]["all"]["errors"] == 0
    if REPORT.parent.is_dir():
        REPORT.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
