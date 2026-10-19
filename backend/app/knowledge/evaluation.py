"""Retrieval evaluation over the curated sources (English, Arabic, Egyptian Arabic, mixed).

    python -m app.knowledge.evaluation     # needs DATABASE_URL with the sources ingested

Each case names the source slugs that would be acceptable evidence, or none for an
off-topic question that must find nothing. Engineering metric only: it measures whether
the right documents are found, not whether any answer is clinically appropriate.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.knowledge.retrieval import retrieve

WHO_EN = "who-doing-what-matters-en"
WHO_AR = "who-doing-what-matters-ar"
NIMH_CARE = "nimh-caring-for-your-mental-health-en"
NIMH_STRESS = "nimh-so-stressed-out-en"
CURATED_STATUSES = ("approved", "draft")


@dataclass(frozen=True)
class Case:
    case_id: str
    language: str  # en | ar | arz (Egyptian Arabic) | mixed | off-topic
    message: str
    expected: frozenset[str]  # acceptable source slugs; empty = must find nothing
    history: tuple[str, ...] = field(default_factory=tuple)  # earlier user turns


CASES: tuple[Case, ...] = (
    Case(
        "en-stress-work",
        "en",
        "I've been stressed about work. What general coping techniques might help?",
        frozenset({NIMH_STRESS, NIMH_CARE, WHO_EN}),
    ),
    Case("en-grounding", "en", "Can you explain a simple grounding exercise?", frozenset({WHO_EN})),
    Case(
        "en-habits",
        "en",
        "What are some everyday habits that support wellbeing?",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case(
        "en-sleep",
        "en",
        "How can I sleep better when I'm stressed?",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case("en-hooked", "en", "I keep getting hooked by difficult thoughts", frozenset({WHO_EN})),
    Case("en-self-critical", "en", "How do I stop being so hard on myself?", frozenset({WHO_EN})),
    Case(
        "en-professional",
        "en",
        "When should I talk to a professional?",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case("ar-grounding", "ar", "كيف أمارس تمرين الارتكاز؟", frozenset({WHO_AR})),
    Case("ar-thoughts", "ar", "كيف أتعامل مع الأفكار والمشاعر الصعبة؟", frozenset({WHO_AR})),
    Case("ar-kind", "ar", "كيف أكون لطيفاً مع نفسي؟", frozenset({WHO_AR})),
    Case("arz-stress", "arz", "ازاي اهدى نفسي لما اكون متوتر من الشغل", frozenset({WHO_AR})),
    Case("arz-thoughts", "arz", "اعمل ايه لو الافكار الوحشة مش راضية تسيبني", frozenset({WHO_AR})),
    Case(
        "mixed-arabizi",
        "mixed",
        "ana stressed awi mn el shoghl, a3mel eh?",
        frozenset({NIMH_STRESS, NIMH_CARE, WHO_EN}),
    ),
    Case("mixed-grounding", "mixed", "عايز grounding exercise بالعربي", frozenset({WHO_AR})),
    Case("off-capital", "off-topic", "What is the capital of France?", frozenset()),
    Case("off-laptop", "off-topic", "Recommend a good laptop for programming", frozenset()),
    Case("off-football", "off-topic", "Who won the football match yesterday?", frozenset()),
    Case(
        "follow-arz",
        "arz",
        "Can you explain that in Egyptian Arabic?",
        frozenset({WHO_AR}),
        history=("Can you explain a simple grounding exercise?",),
    ),
    Case(
        "follow-continue",
        "en",
        "Can we continue discussing the earlier stress-management technique?",
        frozenset({NIMH_STRESS, NIMH_CARE, WHO_EN}),
        history=("I've been stressed about work. What general coping techniques might help?",),
    ),
)


# Written after tuning and never used to tune the lexicon: an honest generalisation check.
HELD_OUT: tuple[Case, ...] = (
    Case(
        "ho-en-anxious",
        "en",
        "I feel anxious before exams, any tips?",
        frozenset({NIMH_STRESS, NIMH_CARE, WHO_EN}),
    ),
    Case(
        "ho-en-overthinking",
        "en",
        "My mind won't stop overthinking at night",
        frozenset({WHO_EN, NIMH_CARE, NIMH_STRESS}),
    ),
    Case(
        "ho-en-lonely",
        "en",
        "I feel lonely lately, what can help?",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case(
        "ho-en-motivation",
        "en",
        "How can I find motivation to do what matters to me?",
        frozenset({WHO_EN}),
    ),
    Case("ho-ar-sleep", "ar", "كيف أحسن نومي؟", frozenset({NIMH_CARE, NIMH_STRESS, WHO_AR})),
    Case("ho-arz-sad", "arz", "انا زعلان ومش عارف اعمل ايه", frozenset({WHO_AR})),
    Case("ho-arz-calm", "arz", "عايز اهدى شوية", frozenset({WHO_AR})),
    Case(
        "ho-mixed-sleep",
        "mixed",
        "mesh 3aref anam, any advice?",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case("ho-off-recipe", "off-topic", "Give me a recipe for koshari", frozenset()),
    Case("ho-off-code", "off-topic", "Write a Python function to sort a list", frozenset()),
)


# Held-out v2: written 2026-10-19 BEFORE the second round of retrieval changes, and
# never used to tune them. (HELD_OUT above was seen during that round, so it is now
# reported as a tuning set.) Expected slugs list every acceptable source.
HELD_OUT_V2: tuple[Case, ...] = (
    Case(
        "v2-en-workload",
        "en",
        "What can I do when I feel overwhelmed by my workload?",
        frozenset({NIMH_STRESS, NIMH_CARE, WHO_EN}),
    ),
    Case(
        "v2-en-presentation",
        "en",
        "How do I calm down quickly before a presentation?",
        frozenset({WHO_EN, NIMH_STRESS}),
    ),
    Case(
        "v2-en-sleep-tips",
        "en",
        "Tips for better sleep habits",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case("v2-en-replaying", "en", "I keep replaying a bad memory in my head", frozenset({WHO_EN})),
    Case(
        "v2-en-compassion",
        "en",
        "How can I be more compassionate toward myself?",
        frozenset({WHO_EN}),
    ),
    Case("v2-en-values", "en", "What does acting on my values mean?", frozenset({WHO_EN})),
    Case(
        "v2-en-isolated",
        "en",
        "I feel isolated and disconnected from people",
        frozenset({NIMH_CARE, NIMH_STRESS}),
    ),
    Case(
        "v2-en-coffee",
        "en",
        "Should I cut down on coffee when stressed?",
        frozenset({NIMH_STRESS, NIMH_CARE}),
    ),
    Case("v2-ar-anxiety", "ar", "كيف أتعامل مع القلق؟", frozenset({WHO_AR})),
    Case("v2-ar-tareed", "ar", "ما هي تمارين التأريض؟", frozenset({WHO_AR})),
    Case("v2-ar-sadness", "ar", "كيف أتعامل مع الحزن؟", frozenset({WHO_AR})),
    Case("v2-arz-mind", "arz", "دماغي مش بتبطل تفكير", frozenset({WHO_AR})),
    Case("v2-arz-pressured", "arz", "حاسس إني مضغوط جدا الأيام دي", frozenset({WHO_AR})),
    Case("v2-arz-calmer", "arz", "إزاي أبقى أهدى؟", frozenset({WHO_AR})),
    Case(
        "v2-mixed-reduce-stress",
        "mixed",
        "3ayez a3raf ezay a2alel el stress",
        frozenset({NIMH_STRESS, NIMH_CARE, WHO_EN}),
    ),
    Case(
        "v2-mixed-sleep-arabizi",
        "mixed",
        "ana mesh 3aref anam kwayes",
        frozenset({NIMH_CARE, NIMH_STRESS, WHO_AR}),
    ),
    Case(
        "v2-mixed-tips-sleep",
        "mixed",
        "محتاج tips للنوم",
        frozenset({NIMH_CARE, NIMH_STRESS, WHO_AR}),
    ),
    Case("v2-off-weather", "off-topic", "What's the weather in Cairo tomorrow?", frozenset()),
    Case("v2-off-translate", "off-topic", "Translate this sentence into French", frozenset()),
    Case("v2-off-medication", "off-topic", "What dose of sertraline should I take?", frozenset()),
)


def _slugs_by_chunk(session: Session) -> dict[str, str]:
    rows = session.execute(
        text(
            "select c.id::text, s.slug from app.knowledge_chunks c "
            "join app.knowledge_sources s on s.id = c.source_id"
        )
    )
    return {row[0]: row[1] for row in rows}


def evaluate(
    session: Session,
    statuses: tuple[str, ...] = CURATED_STATUSES,
    cases: tuple[Case, ...] = CASES,
) -> dict[str, object]:
    slug_of = _slugs_by_chunk(session)
    results = []
    for case in cases:
        chunks = retrieve(session, case.message, "adult", statuses, context=list(case.history))
        found = [slug_of[str(c.chunk_id)] for c in chunks]
        if case.expected:
            top1 = bool(found) and found[0] in case.expected
            hit = any(s in case.expected for s in found)
        else:
            top1 = hit = not found
        results.append(
            {
                "case": case.case_id,
                "language": case.language,
                "top1": top1,
                "hit": hit,
                "found": found,
            }
        )
    by_language: dict[str, dict[str, int]] = {}
    for r in results:
        stats = by_language.setdefault(str(r["language"]), {"cases": 0, "top1": 0, "hit": 0})
        stats["cases"] += 1
        stats["top1"] += int(bool(r["top1"]))
        stats["hit"] += int(bool(r["hit"]))
    return {
        "cases": len(results),
        "top1": sum(bool(r["top1"]) for r in results),
        "hit_at_k": sum(bool(r["hit"]) for r in results),
        "by_language": by_language,
        "results": results,
    }


def main() -> None:  # pragma: no cover - thin CLI wrapper
    from app.core.config import Settings
    from app.core.db import session_factory_for

    factory = session_factory_for(Settings())
    if factory is None:
        sys.exit("DATABASE_URL is not set")
    with factory() as session:
        report = {"tuned": evaluate(session), "held_out": evaluate(session, cases=HELD_OUT)}
        print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":  # pragma: no cover
    main()
