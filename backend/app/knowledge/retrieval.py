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

# concept -> (English/Arabizi word prefixes or phrases, Arabic word prefixes).
# Arabic terms are written in normalised form (see normalize_arabic) and are
# matched against normalised words with common prefixes removed.
CONCEPTS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "stress": (
        (
            "stress",
            "pressure",
            "overwhelm",
            "tense",
            "worr",
            "anxi",
            "nervous",
            "burnout",
            "workload",
            "frazzled",
            "on edge",
            # Arabizi
            "da8t",
            "daght",
            "metdaye2",
            "mdaye2",
            "2ala2",
            "tawattor",
            "mot2atar",
        ),
        (
            "ضغط",
            "مضغوط",
            "متوتر",
            "توتر",
            "قلق",
            "قلقان",
            "اجهاد",
            "مخنوق",
            "متضايق",
            "مرهق",
            "ارهاق",
        ),
    ),
    "grounding": (
        ("grounding", "ground myself", "calm", "breath", "panic", "anchor", "settle", "relax"),
        (
            "ارتكاز",
            "ارتكز",
            "تاريض",
            "اهدي",
            "اهدا",
            "اهدى",
            "هدوء",
            "هادي",
            "تنفس",
            "اتنفس",
            "نفس عميق",
        ),
    ),
    "thoughts": (
        (
            "thought",
            "hooked",
            "unhook",
            "feeling",
            "emotion",
            "overthink",
            "rumina",
            "replay",
            "memor",
            "racing",
            "intrusive",
            "mind won",
            "can't stop thinking",
        ),
        ("افكار", "فكره", "تفكير", "بفكر", "مشاعر", "شعور", "احساس", "انفكاك", "دماغ", "ذكري"),
    ),
    "kindness": (
        (
            "kind",
            "compassion",
            "critic",
            "blame",
            "hard on myself",
            "self-esteem",
            "forgive myself",
        ),
        ("لطف", "لطيف", "قاسي", "قسوه", "اسامح نفسي"),
    ),
    "values": (
        ("values", "meaning", "purpose", "motivat", "what matters", "goal"),
        ("قيم", "هدف", "دافع", "حافز", "معني"),
    ),
    "making_room": (
        ("sad", "painful", "grief", "upset", "hurt"),
        ("حزن", "حزين", "زعلان", "متضايق", "الم", "مكسور"),
    ),
    # Not "اهلي" ("my family"): after removing "ال" it collides with الأهلي, the club.
    "connection": (
        ("lonel", "isolat", "disconnect", "alone", "friend", "family", "social", "connected"),
        ("وحيد", "وحده", "لوحدي", "عزله", "اصحاب", "صحاب", "اصدقاء", "عيلتي"),
    ),
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
            "meditat",
            "journal",
            "caffeine",
            "coffee",
            "routine",
        ),
        ("عادات", "عاده", "رياضه", "مشي", "امتنان", "استرخاء", "روتين", "قهوه", "اكل"),
    ),
    # Arabizi: nom/nawm/anam/nayem = sleep, sahran = up all night.
    "sleep": (
        ("sleep", "insomnia", "tired", "nom", "nawm", "anam", "nayem", "sahran"),
        ("نوم", "انام", "نايم", "سهران", "ارق", "تعبان"),
    ),
    "coping": (
        ("cope", "coping", "technique", "professional", "therapist", "counsel", "tips", "advice"),
        ("مختص", "متخصص", "اتعامل", "تعامل", "نصايح", "نصائح"),
    ),
}
CONCEPTS.update(
    {
        # Second source batch (NIMH anxiety and depression, NCCIH, CDC). Vocabulary from
        # general domain knowledge, written before held-out v4 was evaluated.
        "anxiety": (
            ("anxiety", "anxious", "worry", "worri", "nervous", "on edge", "panic", "fear"),
            ("قلق", "قلقان", "خوف", "خايف", "هلع", "توتر"),
        ),
        "low_mood": (
            (
                "depress",
                "low mood",
                "feel down",
                "feeling down",
                "feel low",
                "unmotivated",
                "no energy",
                "empty",
                "sad",
            ),
            ("اكتئاب", "مكتئب", "مزاجي", "مزاج", "زهقان", "حزين", "مخنوق", "طاقه"),
        ),
        "mindfulness": (
            ("mindful", "meditat", "present moment", "breathing practice"),
            ("تامل", "يقظه", "ميديتيشن", "مايندفولنس"),
        ),
        # Not bare "exercise": "grounding exercise" is a practice, not activity.
        "physical_activity": (
            (
                "physical activity",
                "physically active",
                "workout",
                "work out",
                "gym",
                "walk",
                "running",
                "jog",
                "sport",
                "move more",
                "active",
            ),
            ("رياضه", "تمارين رياضيه", "مشي", "جري", "نشاط", "اتمرن"),
        ),
        "media": (
            ("news", "social media", "doomscroll", "scrolling", "screen time"),
            ("اخبار", "سوشيال", "موبايل"),
        ),
    }
)
CONCEPTS["sleep"] = (
    CONCEPTS["sleep"][0] + ("bedroom", "bedtime", "rest", "hours of sleep"),
    CONCEPTS["sleep"][1] + ("سرير", "سهر"),
)
CONCEPTS["coping"] = (
    CONCEPTS["coping"][0] + ("doctor", "provider", "see someone", "professional help"),
    CONCEPTS["coping"][1] + ("دكتور", "طبيب", "اخصائي"),
)

# Search terms each concept contributes, in the documents' own wording.
EXPANSIONS: dict[str, tuple[str, str]] = {
    "stress": ("stress coping", "الضغط النفسي الإجهاد"),
    "grounding": ("grounding slowing", "الارتكاز"),
    "thoughts": ("difficult thoughts feelings unhooking", "الأفكار المشاعر الانفكاك"),
    "kindness": ("kind kindness", "اللطف لطيفاً"),
    "values": ("values", "القيم"),
    "making_room": ("making room feelings", "إفساح المجال"),
    "connection": ("connected friends family support", "الآخرين"),
    # No Arabic source covers these topics, so no Arabic expansion: an incidental word
    # in an unrelated Arabic passage must not count as a topic match.
    "habits": ("habits exercise sleep gratitude relaxing", ""),
    "sleep": ("sleep", ""),
    "coping": ("coping professional", "الضغط النفسي"),
    "anxiety": ("anxiety worry nervous generalized anxiety disorder", "القلق"),
    "low_mood": ("low mood depression sad interest energy", "حزناً"),
    "mindfulness": ("mindfulness meditation present moment", ""),
    "physical_activity": ("physical activity moderate-intensity walking", ""),
    "media": ("news social media breaks unwind", ""),
}

_DIACRITICS = re.compile(
    "[" + chr(0x064B) + "-" + chr(0x0652) + chr(0x0670) + chr(0x0640) + "]"
)  # harakat, dagger alif, tatweel
_PREFIXES = ("وال", "بال", "لل", "فال", "كال", "ال", "و", "ب", "ل", "ف")


def normalize_arabic(word: str) -> str:
    """Normalise spelling variants so lexicon matching is robust (not a stemmer)."""
    word = _DIACRITICS.sub("", word)
    word = re.sub(
        "[" + chr(0x0622) + chr(0x0623) + chr(0x0625) + chr(0x0671) + "]", chr(0x0627), word
    )  # alef forms -> bare alef
    # alef maqsura -> yeh, teh marbuta -> heh
    return word.replace(chr(0x0649), chr(0x064A)).replace(chr(0x0629), chr(0x0647))


def _arabic_forms(word: str) -> set[str]:
    """The normalised word, and the word with one common prefix removed."""
    base = normalize_arabic(word)
    forms = {base}
    for prefix in _PREFIXES:
        if base.startswith(prefix) and len(base) - len(prefix) >= 2:
            forms.add(base[len(prefix) :])
    return forms


_SQL = text(
    """
    WITH matches AS (
      SELECT c.id, c.content, s.title, s.publisher, s.source_ref, s.version_label,
             s.review_status, s.language,
             ts_rank_cd(c.search_vector, q.topic) AS topic_rank,
             ts_rank_cd(c.search_vector, q.query) AS query_rank
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
    )
    SELECT id, content, title, publisher, source_ref, version_label, review_status
    FROM matches
    -- The user's language wins only for passages that actually match the topic, so an
    -- unrelated passage in the user's language never outranks a relevant one.
    ORDER BY (language = :lang AND topic_rank > 0) DESC, topic_rank DESC, query_rank DESC, id
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
    # Arabizi digits (2, 3, 5, 7, 8, 9) are letters, so keep them inside Latin words.
    latin = re.findall(r"[a-z0-9][a-z0-9']{2,}", lowered)
    arabic_forms = set().union(*(_arabic_forms(w) for w in _ARABIC_WORD.findall(text_)))
    normalized_text = " ".join(normalize_arabic(w) for w in text_.split())
    found = set()
    for name, (english, arabic_terms) in CONCEPTS.items():
        phrase = any(" " in t and t in lowered for t in english)
        word = any(w.startswith(t) for w in latin for t in english if " " not in t)
        arabic_word = any(
            f.startswith(t) for f in arabic_forms for t in arabic_terms if " " not in t
        ) or any(" " in t and t in normalized_text for t in arabic_terms)
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
