"""Understand a message for one assistant (structured mode, D-56).

Order, all before any limit, retrieval or model call:

1. **Risk screens**: crisis and distress go to support; in relationship and family
   assistants, signs of abuse, threats or control go to a safety-focused support response.
   Personal details (contact data, links) are refused; diagnosis and medication are
   refused for every assistant; regulated advice (investment, tax, legal) and, for
   fitness, injuries and medical conditions are refused with a pointer to a professional;
   sexual content, substances and weapons are out of scope.
2. **Subtopics**: the assistant's lexicon finds up to three specific concerns. Unknown
   words are ignored. If the message fits another assistant much better, a handoff is
   suggested; nothing is shared with that assistant.
3. **Composed question**: "In a marriage ..., what are practical ways to <concern 1>,
   <concern 2> and <concern 3>?" plus allow-listed context labels. This, never the user's
   own sentence, is what retrieval and the model see. Personal details are dropped.

Engineering keyword screens: they miss indirect wording and are not a clinical
assessment (see OPEN_DECISIONS D-52/D-56).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from app.assistants.lexicon import LEXICON, Subtopic
from app.assistants.registry import ASSISTANTS, Assistant
from app.conversations.intents import (
    _AR_CONTEXT,
    _EN_CONTEXT,
    _PERSONAL_DETAILS,
    CRISIS_SCREEN,
    DISTRESS_SCREEN,
    MAX_TYPED_CHARS,
)
from app.knowledge.retrieval import normalize_arabic

Outcome = Literal[
    "accept",
    "crisis",
    "relationship_safety",
    "personal_details",
    "clinical",
    "regulated",
    "sensitive",
    "needs_detail",
    "needs_context",
    "too_long",
]
MAX_SUBTOPICS = 3

_HARM_IN_RELATIONSHIPS = (
    "abuse",
    "abused",
    "abusive",
    "hits me",
    "hit me",
    "beats me",
    "slaps me",
    "threaten",
    "afraid of him",
    "afraid of her",
    "scared of him",
    "scared of her",
    "controls me",
    "won't let me",
    "locks me",
    "forced me",
    "force me",
    "shoved me",
    "shoves me",
    "pushed me against",
    "pushed me down",
    "pushed me into",
    "slapped me",
    "slaps me",
    "kicked me",
    "kicks me",
    "punched me",
    "punches me",
    "choked me",
    "chokes me",
    "strangled me",
    "strangles me",
    "grabbed me by",
    "throws things at me",
    "threw things at me",
    "burned me",
    "doesn't allow me to leave",
    "doesnt allow me to leave",
    "won't allow me",
    "not allowed to leave",
    "checks my phone",
    "took my passport",
    "takes my passport",
    "took my salary",
    "takes my salary",
    "takes my money",
    "زقني ووقعت",
    "زقني وقعت",
    "زقني في الحيطه",
    "زقني جامد",
    "خنقني",
    "بيخنقني",
    "ضربني",
    "ضربتني",
    "قلم علي وشي",
    "ادانى قلم",
    "اداني قلم",
    "مش بيخليني اخرج",
    "بيمنعني اخرج",
    "بيفتش موبايلي",
    "اخد فلوسي",
    "واخد مرتبي",
    "اخد الباسبور",
    "بيضربني",
    "بتضربني",
    "بيضربوني",
    "بيهددني",
    "بتهددني",
    "خايفه منه",
    "خايف منها",
    "بيحبسني",
    "غصبن عني",
    "تحرش",
    "اعتداء",
)
_CLINICAL = (
    "diagnose",
    "diagnosis",
    "do i have",
    "disorder",
    "depression",
    "depressed",
    "bipolar",
    "sociopath",
    "psychopath",
    "narcissist",
    "schizophren",
    "psychosis",
    "adhd",
    " ocd",
    "ptsd",
    "medication",
    "medicine",
    " meds",
    " pills",
    " pill ",
    "antidepress",
    "ssri",
    "xanax",
    "valium",
    "prozac",
    "zoloft",
    " dose",
    "dosage",
    "prescri",
    "تشخيص",
    "شخصني",
    "اكتئاب",
    "اضطراب",
    "ثنائي القطب",
    "فصام",
    " دوا",
    "دواء",
    "ادويه",
    "حبوب",
    "جرعه",
    "مهدئ",
    "منوم",
    "روشته",
)
_FITNESS_MEDICAL = (
    "injur",
    "sprain",
    "fracture",
    "chest pain",
    "pain",
    "heart condition",
    "pregnan",
    "diabet",
    "blood pressure",
    "eating disorder",
    "anorexi",
    "bulimi",
    "steroid",
    "supplement",
    "اصابه",
    "اتصابت",
    "وجع",
    "الم ",
    "حامل",
    "سكر",
    "ضغط الدم",
    "مكملات",
)
_REGULATED = (
    "invest",
    "stocks",
    "shares",
    "crypto",
    "bitcoin",
    "trading",
    " tax",
    "lawyer",
    "lawsuit",
    " court",
    "custody",
    "legal",
    " sue ",
    "sue my",
    "suing",
    "labour law",
    "labor law",
    "egyptian law",
    "under the law",
    "the law say",
    "alimony",
    "inheritance",
    "property split",
    "قانون العمل",
    "القانون",
    "نفقه",
    "ميراث",
    "قايمه المنقولات",
    "استثمار",
    "اسهم",
    "بورصه",
    "كريبتو",
    "ضرايب",
    "ضرائب",
    "محامي",
    "قضيه",
    "محكمه",
    "حضانه",
)
_SENSITIVE = (
    " sex",
    "porn",
    "drugs",
    " weed",
    "cocaine",
    "hashish",
    "gambl",
    "weapon",
    " gun",
    "revenge",
    "مخدرات",
    "حشيش",
    "سلاح",
    "انتقام",
    "جنس",
)
_INJECTION = re.compile(
    r"ignore (all |any )?(previous|prior|above) instructions|system prompt|developer mode|"
    r"you are now|reveal (your|the) (prompt|instructions)|تجاهل (كل )?التعليمات",
    re.IGNORECASE,
)
_FOLLOW_EN = {
    "in-arabic": ("arabic", "egyptian", "translate"),
    "continue": ("tell me more", "more detail", "continue", "elaborate", "go on", "explain more"),
    "summary": ("summary", "summarize", "summarise", "sum up", "recap", "in short"),
    "next": ("what next", "next step", "what should i do first", "how do i start"),
}
_FOLLOW_AR = {
    "in-arabic": ("بالعاميه", "بالمصري", "بالعربي", "ترجم"),
    "continue": ("كمل", "نكمل", "اكتر", "تفاصيل", "وضح"),
    "summary": ("ملخص", "لخص", "باختصار"),
    "next": ("اعمل ايه الاول", "ابدا منين", "الخطوه الجايه"),
}
_FOLLOW_QUESTION = {
    "in-arabic": (
        "Please explain the previous answer in Egyptian Arabic.",
        "ممكن تشرح الإجابة اللي فاتت بالعامية المصرية؟",
    ),
    "continue": (
        "Please go into more detail on the previous answer.",
        "ممكن تفاصيل أكتر عن الإجابة اللي فاتت؟",
    ),
    "summary": (
        "Please summarise the previous answer briefly.",
        "ممكن ملخص قصير للإجابة اللي فاتت؟",
    ),
    "next": (
        "What is a good first step from the previous answer?",
        "إيه أول خطوة كويسة من الإجابة اللي فاتت؟",
    ),
}
_ARABIC_CHAR = re.compile("[؀-ۿ]")
_ARABIC_WORD = re.compile("[ء-يٱ-ۓ]+")
_LATIN_WORD = re.compile(r"[a-z][a-z'-]*")
_AR_PREFIXES = ("وبال", "وال", "بال", "لل", "فال", "كال", "ال", "و", "ب", "ل", "ف")
_AR_SUFFIXES = ("هالي", "كوا", "ها", "هم", "نا", "ني", "لي", "ه", "ك", "ي", "ات")


@dataclass(frozen=True)
class Understanding:
    outcome: Outcome
    assistant_id: str
    language: Literal["en", "ar"] = "en"
    subtopics: tuple[Subtopic, ...] = ()
    context: tuple[str, ...] = ()
    question: str = ""  # what retrieval and the model see; never the user's sentence
    follow_up: str | None = None
    handoff: str | None = None  # a better-suited assistant, suggested to the user
    secondary_domains: tuple[str, ...] = field(default=())

    @property
    def search_en(self) -> str:
        return " ".join(s.search_en for s in self.subtopics)

    @property
    def search_ar(self) -> str:
        return " ".join(s.search_ar for s in self.subtopics)

    @property
    def subtopic_keys(self) -> str:
        return ",".join(s.key for s in self.subtopics)


def _has(text: str, terms: tuple[str, ...]) -> bool:
    return any(t in text or normalize_arabic(t) in text for t in terms)


def _ar_forms(word: str) -> set[str]:
    forms = {word}
    for p in _AR_PREFIXES:
        if word.startswith(p) and len(word) - len(p) >= 2:
            forms.add(word[len(p) :])
    for f in list(forms):
        for s in _AR_SUFFIXES:
            if f.endswith(s) and len(f) - len(s) >= 2:
                forms.add(f[: -len(s)])
    return forms


def _en_hit(term: str, words: list[str], text: str) -> bool:
    if "_" in term:
        return term.replace("_", " ") in text
    if term.endswith("*"):
        stem = term[:-1]
        return any(w.startswith(stem) for w in words)
    return term in words


def _ar_hit(term: str, forms: set[str], text: str) -> bool:
    if "_" in term:
        return normalize_arabic(term.replace("_", " ")) in text
    return normalize_arabic(term) in forms


def score_subtopics(assistant_id: str, text: str) -> list[tuple[Subtopic, int]]:
    lowered = text.casefold()
    folded = normalize_arabic(lowered)
    words = _LATIN_WORD.findall(lowered)
    forms: set[str] = set()
    for w in _ARABIC_WORD.findall(folded):
        forms |= _ar_forms(w)
    scored = []
    for sub in LEXICON.get(assistant_id, ()):
        n = sum(_en_hit(t, words, lowered) for t in sub.en) + sum(
            _ar_hit(t, forms, folded) for t in sub.ar
        )
        if n:
            scored.append((sub, n))
    scored.sort(key=lambda pair: -pair[1])
    return scored


def _context_labels(text: str, is_arabic: bool) -> tuple[str, ...]:
    table = _AR_CONTEXT if is_arabic else _EN_CONTEXT
    folded = normalize_arabic(text.casefold())
    tokens = set(_ARABIC_WORD.findall(folded)) | set(_LATIN_WORD.findall(folded))
    expanded: set[str] = set()
    for t in tokens:
        expanded |= _ar_forms(t) if is_arabic else {t}
    labels: list[str] = []
    for key, label in table.items():
        if key in expanded and label not in labels:
            labels.append(label)
    return tuple(labels[:2])


def compose(
    assistant: Assistant, subtopics: tuple[Subtopic, ...], language: str, context: tuple[str, ...]
) -> str:
    if language == "ar":
        phrases = [s.phrase_ar for s in subtopics]
        body = phrases[0] if len(phrases) == 1 else "، ".join(phrases[:-1]) + " و" + phrases[-1]
        question = f"{assistant.frame_ar} {body}؟"
        return f"{question} (السياق: {'، '.join(context)})" if context else question
    phrases = [s.phrase_en for s in subtopics]
    body = phrases[0] if len(phrases) == 1 else ", ".join(phrases[:-1]) + " and " + phrases[-1]
    question = f"{assistant.frame_en} {body}?"
    return f"{question} (Context: {', '.join(context)})" if context else question


def _best_other(assistant: Assistant, text: str, own_score: int) -> str | None:
    best, best_score = None, own_score
    for other in ASSISTANTS:
        if other.assistant_id in (assistant.assistant_id, "everyday"):
            continue
        score = sum(n for _, n in score_subtopics(other.assistant_id, text))
        if score >= best_score + 2:  # clearly a better fit, not a tie
            best, best_score = other.assistant_id, score
    return best


def understand(assistant: Assistant, message: str, has_history: bool) -> Understanding:
    aid = assistant.assistant_id
    text = " ".join(message.split())
    is_arabic = bool(_ARABIC_CHAR.search(text))
    language: Literal["en", "ar"] = "ar" if is_arabic else "en"
    if len(text) > MAX_TYPED_CHARS:
        return Understanding("too_long", aid, language)
    lowered = text.casefold().replace("’", "'")
    padded = f" {normalize_arabic(lowered)} "

    if _has(padded, CRISIS_SCREEN):
        return Understanding("crisis", aid, language)
    if _has(padded, _HARM_IN_RELATIONSHIPS):
        if aid in ("relationships", "family", "social"):
            return Understanding("relationship_safety", aid, language)
        return Understanding("crisis", aid, language)
    if _has(padded, DISTRESS_SCREEN):
        return Understanding("crisis", aid, language)
    if _PERSONAL_DETAILS.search(lowered):
        return Understanding("personal_details", aid, language)
    if _has(padded, _CLINICAL) or (aid == "fitness" and _has(padded, _FITNESS_MEDICAL)):
        return Understanding("clinical", aid, language)
    if _has(padded, _REGULATED):
        return Understanding("regulated", aid, language)
    if _has(padded, _SENSITIVE) or _INJECTION.search(text):
        return Understanding("sensitive", aid, language)

    follow_tables = _FOLLOW_AR if is_arabic else _FOLLOW_EN
    follow = next((k for k, phrases in follow_tables.items() if _has(padded, phrases)), None)
    if follow == "in-arabic":
        language = "ar"

    scored = score_subtopics(aid, text)
    own_score = sum(n for _, n in scored)
    handoff = _best_other(assistant, text, own_score)
    if not scored:
        if follow and has_history:
            question = _FOLLOW_QUESTION[follow][1 if language == "ar" else 0]
            return Understanding("accept", aid, language, question=question, follow_up=follow)
        if follow:
            return Understanding("needs_context", aid, language)
        return Understanding("needs_detail", aid, language, handoff=handoff)

    subtopics = tuple(s for s, _ in scored[:MAX_SUBTOPICS])
    context = _context_labels(text, is_arabic)
    # Secondary domains are searched only when the message explicitly touches them.
    secondary = tuple(
        d
        for d in assistant.secondary_domains
        if any(sub.signal for sub, _ in score_subtopics(d, text))
    )
    return Understanding(
        "accept",
        aid,
        language,
        subtopics=subtopics,
        context=context,
        question=compose(assistant, subtopics, language, context),
        handoff=handoff,
        secondary_domains=secondary,
    )
