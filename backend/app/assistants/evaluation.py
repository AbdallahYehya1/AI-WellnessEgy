"""Retrieval evaluation for the specialised assistants (D-56).

    python -m app.assistants.evaluation      # needs DATABASE_URL with the sources ingested

Held-out questions written for evaluation (not copied from source headings), in English,
Arabic and Egyptian Arabic, including cross-domain and off-topic cases. Each case runs
three ways so the effect of the architecture is measured rather than assumed:

- ``baseline``: the pre-assistant general retrieval (wellbeing lexicon, all sources);
- ``monolithic``: the new knowledge and query understanding, but no domain filter;
- ``domain``: the assistant pipeline, filtered to the assistant's domains in SQL.

Metrics per mode: hit@4 (an acceptable source among the passages), top-1, precision
(share of passages from acceptable sources) and leakage (share of passages from domains
the assistant may not use). Engineering retrieval metrics only; they say nothing about
whether an answer is good advice.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.assistants.context import redact
from app.assistants.registry import BY_ID, DOMAINS
from app.assistants.understanding import Understanding, understand
from app.knowledge.retrieval import (
    retrieve,
    retrieve_hybrid,
    retrieve_safety_resources,
    retrieve_terms,
)

STATUSES = ("approved", "draft")

COMM = "cdc-healthy-communication-en"
# NHS sources were retired (D-58); their cases now accept the closest replacements.
REL = "cdc-healthy-communication-en"
SOLVE = "opm-performance-playbook-en"
MONEY = "cfpb-emergency-fund-en"
NIOSH = "niosh-stress-at-work-en"
WORK = "niosh-stress-at-work-page-en"
OPM = "opm-individual-development-planning-en"
CHANGE = "opm-career-development-en"
TODO = "opm-performance-playbook-en"

# Sources added in the D-61 expansion that legitimately answer some earlier cases.
WORKLIFE = "opm-work-life-en"
BUDGET = "cfpb-budgeting-en"
SPENDING = "cfpb-managing-spending-en"
MONEY_TIPS = "cfpb-money-smart-tips-en"
SAVINGS = "cfpb-savings-habit-en"
PERF = "opm-performance-management-cycle-en"
PLAYBOOK = "opm-performance-playbook-en"


@dataclass(frozen=True)
class Case:
    case_id: str
    assistant: str
    language: str  # en | ar | arz (Egyptian Arabic) | mixed
    message: str
    expected: frozenset[str]  # acceptable source slugs


def _c(cid: str, assistant: str, language: str, message: str, *expected: str) -> Case:
    return Case(cid, assistant, language, message, frozenset(expected))


CASES: tuple[Case, ...] = (
    # --- Marriage & Healthy Relationships ---
    _c(
        "rel-listen",
        "relationships",
        "en",
        "Whenever I bring something up my husband interrupts me, how do we actually "
        "hear each other?",
        COMM,
        REL,
    ),
    _c(
        "rel-cooldown",
        "relationships",
        "en",
        "Our fights get loud fast and then nobody listens. What can we do in the moment?",
        COMM,
        REL,
    ),
    _c(
        "rel-money",
        "relationships",
        "en",
        "My wife and I disagree about how much to spend each month on going out.",
        COMM,
        REL,
        MONEY,
        SOLVE,
        BUDGET,
        SPENDING,
        MONEY_TIPS,
    ),
    _c(
        "rel-worklate",
        "relationships",
        "en",
        "She is upset that I keep working late, but I'm trying to build our savings. "
        "How do we find a balance?",
        REL,
        COMM,
        MONEY,
        WORKLIFE,
    ),
    _c(
        "rel-future",
        "relationships",
        "en",
        "My fiancee wants to move abroad after the wedding and I want to stay; we keep going in "
        "circles.",
        COMM,
        REL,
        SOLVE,
    ),
    _c(
        "rel-boundaries",
        "relationships",
        "en",
        "His family visits without asking and I don't know how to raise it without a fight.",
        REL,
        COMM,
    ),
    _c(
        "rel-ar-fight",
        "relationships",
        "arz",
        "أنا ومراتي بنتخانق على أي حاجة صغيرة، نعمل إيه عشان نهدى ونتكلم؟",
        COMM,
        REL,
    ),
    _c(
        "rel-ar-listen",
        "relationships",
        "arz",
        "جوزي مش بيسمعني لما بتكلم، أوصله إزاي اللي جوايا؟",
        COMM,
        REL,
    ),
    _c(
        "rel-ar-msa", "relationships", "ar", "كيف نتواصل بشكل أفضل عندما نختلف في الرأي؟", COMM, REL
    ),
    _c(
        "rel-ar-money",
        "relationships",
        "arz",
        "بنختلف على المصاريف كل شهر وده عامل مشاكل بينا",
        COMM,
        REL,
        MONEY,
        SOLVE,
        BUDGET,
        SPENDING,
        MONEY_TIPS,
    ),
    _c(
        "rel-mixed",
        "relationships",
        "mixed",
        "أنا وخطيبتي مش متفقين على plans بتاعة المستقبل",
        COMM,
        REL,
        SOLVE,
    ),
    # --- Career & Work ---
    _c(
        "car-stuck",
        "career",
        "en",
        "Three years in the same role and no promotion in sight. How do I move forward?",
        OPM,
        NIOSH,
    ),
    _c(
        "car-feedback",
        "career",
        "en",
        "My boss criticises my reports in front of the team. How should I respond?",
        WORK,
        NIOSH,
    ),
    _c(
        "car-switch",
        "career",
        "en",
        "I got an offer from another company but I'm not sure if I should leave or learn more "
        "where I am.",
        CHANGE,
        SOLVE,
        OPM,
    ),
    _c(
        "car-overload",
        "career",
        "en",
        "Deadlines keep piling up and I end up working every weekend.",
        WORK,
        NIOSH,
        TODO,
    ),
    _c(
        "car-colleague",
        "career",
        "en",
        "A coworker keeps taking over my tasks and it creates tension in the team.",
        WORK,
        NIOSH,
    ),
    _c(
        "car-focus",
        "career",
        "en",
        "I keep postponing the big project and doing small emails instead.",
        TODO,
        WORK,
    ),
    _c(
        "car-ar-stuck",
        "career",
        "arz",
        "حاسس إني واقف مكاني في الشغل ومش بتقدم، أعمل إيه؟",
        OPM,
        NIOSH,
    ),
    _c(
        "car-ar-boss",
        "career",
        "arz",
        "مديري بينتقد شغلي على طول، أرد عليه إزاي من غير مشاكل؟",
        WORK,
        NIOSH,
        PERF,
        PLAYBOOK,
    ),
    _c(
        "car-ar-pressure",
        "career",
        "arz",
        "ضغط الشغل كتير جدًا ومواعيد التسليم مش مخلياني أرتاح",
        WORK,
        NIOSH,
        TODO,
    ),
    _c(
        "car-ar-msa",
        "career",
        "ar",
        "هل أغير وظيفتي أم أطور مهاراتي في عملي الحالي؟",
        CHANGE,
        SOLVE,
        OPM,
    ),
    _c(
        "car-mixed",
        "career",
        "mixed",
        "عندي deadline كل يوم والمدير بيزود المهام",
        WORK,
        NIOSH,
        TODO,
    ),
)


# Written after the lexicon was adjusted on CASES, and never used for tuning: the honest
# estimate of how the understanding step generalises to new wording.
HELD_OUT_V2: tuple[Case, ...] = (
    _c(
        "v2-rel-silent",
        "relationships",
        "en",
        "When we disagree my partner goes quiet for days. How can we talk it through?",
        COMM,
        REL,
    ),
    _c(
        "v2-rel-respect",
        "relationships",
        "en",
        "How do I tell my husband I feel unheard without starting an argument?",
        COMM,
        REL,
    ),
    _c(
        "v2-rel-plans",
        "relationships",
        "en",
        "We can't agree whether to have the wedding this year or save first.",
        COMM,
        REL,
        SOLVE,
        MONEY,
        BUDGET,
        SPENDING,
        MONEY_TIPS,
        SAVINGS,
    ),
    _c(
        "v2-rel-trust",
        "relationships",
        "en",
        "After a lie last month I find it hard to trust my wife again.",
        COMM,
        REL,
    ),
    _c(
        "v2-rel-arz-inlaws",
        "relationships",
        "arz",
        "حماتي بتتدخل في كل حاجة بينا وجوزي مش بيقول حاجة",
        REL,
        COMM,
    ),
    _c(
        "v2-rel-arz-time",
        "relationships",
        "arz",
        "مراتي بتقول إني مش بقعد معاها عشان الشغل، أعمل إيه؟",
        REL,
        COMM,
        WORKLIFE,
    ),
    _c(
        "v2-car-raise",
        "career",
        "en",
        "I want to ask for more responsibility at work but don't know how to bring it up "
        "with my manager.",
        OPM,
        WORK,
        PERF,
        PLAYBOOK,
    ),
    _c(
        "v2-car-burnout",
        "career",
        "en",
        "I'm exhausted from overtime and can't switch off in the evenings.",
        WORK,
        NIOSH,
    ),
    _c(
        "v2-car-team",
        "career",
        "en",
        "There's constant friction between me and a teammate over who does what.",
        WORK,
        NIOSH,
    ),
    _c(
        "v2-car-skills",
        "career",
        "en",
        "Which skills should I build to grow in my career over the next year?",
        OPM,
    ),
    _c(
        "v2-car-arz-quit",
        "career",
        "arz",
        "بفكر أسيب شغلي وأدور على حاجة جديدة بس خايف",
        CHANGE,
        SOLVE,
        OPM,
    ),
    _c(
        "v2-car-arz-tasks",
        "career",
        "arz",
        "عندي مهام كتير ومش عارف أرتب أولوياتي في الشغل",
        TODO,
        WORK,
    ),
)


def _slugs(session: Session) -> tuple[dict[str, str], dict[str, tuple[str, ...]]]:
    rows = session.execute(
        text(
            "select c.id::text, s.slug, s.domains from app.knowledge_chunks c "
            "join app.knowledge_sources s on s.id = c.source_id"
        )
    ).all()
    return {r[0]: r[1] for r in rows}, {r[0]: tuple(r[2] or ()) for r in rows}


def _score(
    found: list[str], doms: list[tuple[str, ...]], case: Case, allowed: set[str]
) -> dict[str, Any]:
    leaked = sum(1 for d in doms if not set(d) & allowed)
    return {
        "hit": any(s in case.expected for s in found),
        "top1": bool(found) and found[0] in case.expected,
        "precision": (sum(s in case.expected for s in found) / len(found)) if found else 0.0,
        "leakage": (leaked / len(doms)) if doms else 0.0,
        "found": found,
    }


def _search(session: Session, u: Understanding, domains: tuple[str, ...]) -> list[str]:
    chunks = retrieve_terms(
        session,
        english=u.search_en,
        arabic=u.search_ar,
        language=u.language,
        age_band="adult",
        statuses=STATUSES,
        domains=domains,
    )
    return [str(c.chunk_id) for c in chunks]


def evaluate(session: Session, cases: tuple[Case, ...] = CASES) -> dict[str, Any]:
    slug_of, domains_of = _slugs(session)
    results = []
    for case in cases:
        assistant = BY_ID[case.assistant]
        u = understand(assistant, case.message, has_history=False)
        allowed = {assistant.domain, *u.secondary_domains}
        modes: dict[str, list[str]] = {}
        base = retrieve(session, case.message, "adult", STATUSES)
        modes["baseline"] = [str(c.chunk_id) for c in base]
        if u.outcome == "accept":
            modes["monolithic"] = _search(session, u, DOMAINS)
            modes["domain"] = _search(session, u, (assistant.domain, *u.secondary_domains))
        else:
            modes["monolithic"] = modes["domain"] = []
        # Opted-in provider context (D-59): subtopic terms plus the redacted message.
        hybrid = (
            retrieve_hybrid(
                session,
                english=u.search_en,
                arabic=u.search_ar,
                free_text=redact(case.message).text,
                language=u.language,
                age_band="adult",
                statuses=STATUSES,
                domains=(assistant.domain, *u.secondary_domains),
            )
            if u.outcome in ("accept", "needs_detail", "needs_context")
            else []
        )
        modes["hybrid"] = [str(c.chunk_id) for c in hybrid]
        if u.outcome == "relationship_safety":
            # What the person sees: the safety notice with vetted sources (no model).
            safety = retrieve_safety_resources(
                session, free_text=redact(case.message).text, age_band="adult", statuses=STATUSES
            )
            modes["domain"] = modes["hybrid"] = [str(c.chunk_id) for c in safety]
        row: dict[str, Any] = {
            "case": case.case_id,
            "assistant": case.assistant,
            "language": case.language,
            "understood": u.outcome,
            "subtopics": u.subtopic_keys,
        }
        for mode, ids in modes.items():
            row[mode] = _score(
                [slug_of[i] for i in ids], [domains_of[i] for i in ids], case, allowed
            )
        results.append(row)
    return {"summary": summarise(results), "results": results}


def summarise(results: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    groups: dict[str, list[dict[str, Any]]] = {}
    for r in results:
        groups.setdefault(f"{r['assistant']}", []).append(r)
        groups.setdefault(f"{r['assistant']}/{r['language']}", []).append(r)
        groups.setdefault("all", []).append(r)
    for name, rows in sorted(groups.items()):
        stats: dict[str, Any] = {"cases": len(rows)}
        for mode in ("baseline", "monolithic", "domain", "hybrid"):
            scored: list[dict[str, Any]] = [r[mode] for r in rows]
            n = len(rows)
            stats[mode] = {
                "hit_at_4": round(sum(bool(x["hit"]) for x in scored) / n, 3),
                "top1": round(sum(bool(x["top1"]) for x in scored) / n, 3),
                "precision": round(sum(float(x["precision"]) for x in scored) / n, 3),
                "leakage": round(sum(float(x["leakage"]) for x in scored) / n, 3),
            }
        out[name] = stats
    return out


def main() -> None:  # pragma: no cover - thin CLI wrapper
    from app.core.config import Settings
    from app.core.db import session_factory_for

    factory = session_factory_for(Settings())
    if factory is None:
        sys.exit("DATABASE_URL is not set")
    with factory() as session:
        print(json.dumps(evaluate(session), indent=2, ensure_ascii=False))


if __name__ == "__main__":  # pragma: no cover
    main()
