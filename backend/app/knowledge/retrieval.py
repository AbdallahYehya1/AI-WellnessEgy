"""Approved, age-applicable retrieval with PostgreSQL full-text search.

Filters are applied in SQL, so unapproved, withdrawn, expired or other-age-band content
can never be returned. Query building (engineering choices, evaluated in
app/knowledge/evaluation.py; not clinical rules):

- English words are searched with the English configuration and Arabic words with the
  Arabic one. Mixing them let stopwords like "is", "the" or "في" match everything.
- A small bilingual topic lexicon gates retrieval: a message with no wellness topic finds
  nothing (the assistant then says it has no information), and a matched concept adds its
  English and Arabic terms so "grounding" can find "الارتكاز" and vice versa.
- A follow-up with no topic of its own ("explain that in Egyptian Arabic") is searched with
  the user's previous turns.
- Sources in the language the user writes in, or asks for, rank first.

Known limitation: Egyptian Arabic and Arabizi are matched through the lexicon, not real
dialect understanding.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session

MAX_PASSAGES = 4
CONTEXT_TURNS = 2
_LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z']{2,}")
_ARABIC_WORD = re.compile(r"[ء-يٱ-ۓ]{2,}")
_ARABIC_CHAR = re.compile(r"[؀-ۿ]")
_ARABIC_REQUEST = re.compile(
    r"\b(arabic|egyptian|3arabi|masri)\b|بالعربي|بالعربية|عربي|بالمصري|مصري", re.IGNORECASE
)

# concept -> (English word prefixes or phrases, Arabic word prefixes).
CONCEPTS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "stress": (
        ("stress", "pressure", "overwhelm", "tense", "worr", "anxi", "nervous", "burnout"),
        ("ضغط", "الضغط", "متوتر", "توتر", "التوتر", "قلق", "مضغوط", "الإجهاد", "مخنوق"),
    ),
    "grounding": (
        ("grounding", "calm", "breath", "panic", "anchor"),
        ("الارتكاز", "ارتكز", "اهدى", "أهدأ", "اهدا", "هدوء", "التنفس", "تنفس"),
    ),
    "thoughts": (
        ("thought", "hooked", "unhook", "feeling", "emotion", "overthink", "rumina"),
        ("الأفكار", "الافكار", "أفكار", "افكار", "المشاعر", "مشاعر", "شعور", "الانفكاك"),
    ),
    "kindness": (
        ("kind", "compassion", "critic", "blame", "hard on myself"),
        ("اللطف", "لطيف", "قاسي", "القاسية"),
    ),
    "values": (("values", "meaning", "purpose"), ("القيم", "قيم")),
    "making_room": (("sad", "painful", "grief"), ("حزن", "حزين", "الألم")),
    "habits": (
        (
            # Not "exercise": in "grounding exercise" it means a practice, not activity.
            "habit",
            "wellbeing",
            "well-being",
            "self-care",
            "physical activity",
            "walk",
            "diet",
            "meal",
            "mood",
            "hydrat",
            "gratitude",
            "grateful",
            "relax",
            "meditat",
            "connected",
            "journal",
            "caffeine",
        ),
        ("عادات", "عادة", "الرياضة", "رياضة", "المشي", "الامتنان", "الاسترخاء", "استرخاء"),
    ),
    # "nom"/"nawm": Arabizi for sleep.
    "sleep": (
        ("sleep", "insomnia", "tired", "nom", "nawm"),
        ("النوم", "نوم", "أنام", "انام", "تعبان"),
    ),
    "coping": (
        ("cope", "coping", "technique", "professional", "therapist", "counsel"),
        ("مختص", "متخصص", "أتعامل", "اتعامل", "التعامل"),
    ),
}
# Search terms each concept contributes, in the documents' own wording.
EXPANSIONS: dict[str, tuple[str, str]] = {
    "stress": ("stress coping", "الضغط النفسي الإجهاد"),
    "grounding": ("grounding slowing", "الارتكاز"),
    "thoughts": ("difficult thoughts feelings unhooking", "الأفكار المشاعر الانفكاك"),
    "kindness": ("kind kindness", "اللطف لطيفاً"),
    "values": ("values", "القيم"),
    "making_room": ("making room feelings", "إفساح المجال"),
    "habits": ("habits exercise sleep gratitude relaxing", "الأنشطة"),
    "sleep": ("sleep", "النوم"),
    "coping": ("coping professional", "الضغط النفسي"),
}

_SQL = text(
    """
    SELECT c.id, c.content, s.title, s.publisher, s.source_ref, s.version_label,
           s.review_status
    FROM app.knowledge_chunks c
    JOIN app.knowledge_sources s ON s.id = c.source_id,
         LATERAL (
           SELECT replace(plainto_tsquery('english', :en_q)::text, '&', '|')::tsquery
               || replace(plainto_tsquery('arabic', :ar_q)::text, '&', '|')::tsquery
               || CASE WHEN :simple_q = '' THEN ''::tsquery
                       ELSE to_tsquery('simple', :simple_q) END AS query,
                  replace(plainto_tsquery('english', :en_topic)::text, '&', '|')::tsquery
               || replace(plainto_tsquery('arabic', :ar_topic)::text, '&', '|')::tsquery AS topic
         ) q
    WHERE c.search_vector @@ q.query
      AND CAST(:band AS text) = ANY (s.age_bands)
      AND s.review_status IN :statuses
      AND (s.expires_at IS NULL OR s.expires_at > now())
    ORDER BY (s.language = :lang) DESC,
             ts_rank_cd(c.search_vector, q.topic) DESC,
             ts_rank_cd(c.search_vector, q.query) DESC, c.id
    LIMIT :limit
    """
).bindparams(bindparam("statuses", expanding=True))


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: uuid.UUID
    content: str
    title: str
    publisher: str
    source_ref: str
    version_label: str
    synthetic: bool
    review_status: str = "approved"


_SIMPLE_STOPWORDS = frozenset(
    {
        "the",
        "and",
        "how",
        "can",
        "you",
        "what",
        "for",
        "with",
        "this",
        "that",
        "are",
        "was",
        "any",
        "about",
        "some",
        "explain",
        "tell",
        "please",
        "ana",
        "enta",
        "enti",
        "mesh",
        "mish",
        "eh",
        "ezay",
        "ezzay",
        "awi",
        "awy",
        "keda",
        "fe",
        "fi",
        "mn",
        "men",
        "el",
    }
)


def _simple_query(text_: str) -> str:
    """Raw Latin tokens (Arabizi has no stemmer). Letters only, so quoting is injection-safe."""
    tokens = {t.lower().replace("'", "") for t in _LATIN_WORD.findall(text_)} - _SIMPLE_STOPWORDS
    return " | ".join(f"'{t}'" for t in sorted(tokens) if t)


@dataclass(frozen=True)
class SearchPlan:
    concepts: frozenset[str]
    english: str
    arabic: str
    language: str
    english_topic: str  # concept terms only: ranks topical chunks above incidental matches
    arabic_topic: str
    simple: str = ""


def _concepts(text_: str) -> set[str]:
    lowered = text_.lower()
    latin = _LATIN_WORD.findall(lowered)
    arabic = _ARABIC_WORD.findall(text_)
    found = set()
    for name, (english, arabic_terms) in CONCEPTS.items():
        phrase = any(" " in t and t in lowered for t in english)
        word = any(w.startswith(t) for w in latin for t in english if " " not in t)
        arabic_word = any(w.startswith(t) for w in arabic for t in arabic_terms)
        if phrase or word or arabic_word:
            found.add(name)
    return found


def plan_search(message: str, context: list[str] | None = None) -> SearchPlan | None:
    """None means: no wellness topic, so there is nothing to retrieve."""
    effective = message
    concepts = _concepts(message)
    if not concepts and context:  # a follow-up: borrow the topic from earlier turns
        effective = " ".join([*context[-CONTEXT_TURNS:], message])
        concepts = _concepts(effective)
    if not concepts:
        return None
    arabic_share = len(_ARABIC_CHAR.findall(message)) / max(len(message.strip()), 1)
    language = "ar" if _ARABIC_REQUEST.search(message) or arabic_share > 0.3 else "en"
    english = " ".join(
        _LATIN_WORD.findall(effective) + [EXPANSIONS[c][0] for c in sorted(concepts)]
    )
    arabic = " ".join(
        _ARABIC_WORD.findall(effective) + [EXPANSIONS[c][1] for c in sorted(concepts)]
    )
    return SearchPlan(
        frozenset(concepts),
        english,
        arabic,
        language,
        english_topic=" ".join(EXPANSIONS[c][0] for c in sorted(concepts)),
        arabic_topic=" ".join(EXPANSIONS[c][1] for c in sorted(concepts)),
        simple=_simple_query(effective),
    )


def retrieve(
    session: Session,
    message: str,
    age_band: str,
    statuses: tuple[str, ...],
    *,
    context: list[str] | None = None,
) -> list[RetrievedChunk]:
    plan = plan_search(message, context)
    if plan is None:
        return []
    rows = session.execute(
        _SQL,
        {
            "en_q": plan.english,
            "ar_q": plan.arabic,
            "en_topic": plan.english_topic,
            "ar_topic": plan.arabic_topic,
            "simple_q": plan.simple,
            "band": age_band,
            "statuses": list(statuses),
            "lang": plan.language,
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
            review_status=row.review_status,
        )
        for row in rows
    ]
