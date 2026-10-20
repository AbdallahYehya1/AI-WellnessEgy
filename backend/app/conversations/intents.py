"""Risk-aware eligibility for typed chat messages (OPEN_DECISIONS D-53, revised D-55).

Users can phrase questions naturally ("I'm stressed about exams, what might help?",
"what can I do to relax after a difficult day?"). Each message goes through, in order:

1. **Crisis and distress screen** (engineering keyword lists, NOT clinical): any match is
   routed to the support response, never to generation.
2. **Personal-details screen**: e-mail addresses, phone numbers, links and handles are
   refused ("please remove personal details").
3. **Clinical and sensitive screen**: diagnosis, medication and doses, physical symptoms,
   substances, sexual content, violence and abuse are refused with a pointer to a
   professional. These are out of scope for an education-only assistant.
4. **Topic recognition**: a bilingual lexicon (English, Modern Standard and Egyptian
   Arabic, with spelling normalisation and clitic stripping) must place the question in
   exactly one reviewed topic (or a follow-up of an earlier recognised question). Words
   it doesn't know are ignored rather than refused, so ordinary wording works.

An accepted message is **re-expressed** as a general question about its topic plus, at
most, a few allow-listed context labels ("exams", "work", "evenings"). Only that
re-expression, never the user's own sentence, reaches safety assessment, retrieval and
Groq: personal details a user includes are dropped, not forwarded.

Limits (stated plainly): this is an engineering control, not a clinical risk assessment.
Keyword screens miss things, especially indirect phrasing and Arabizi; the support
response is a placeholder pending clinical review (D-13). It answers general educational
questions about seven topics, not open conversation.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Literal

from app.conversations.demo import DEMO_PROMPTS, DemoPrompt, normalize
from app.knowledge.retrieval import normalize_arabic

MAX_TYPED_CHARS = 500

GateOutcome = Literal[
    "accept",
    "crisis",
    "unsupported",
    "multiple_topics",
    "needs_context",
    "too_long",
    "personal_details",
    "clinical",
    "sensitive",
]
Language = Literal["en", "ar"]

# --- Screens (substring match on lower-cased, Arabic-normalised text) -----------------

# Engineering safety net, NOT clinical. Any match goes to the support response.
CRISIS_SCREEN: tuple[str, ...] = (
    "suicide",
    "suicidal",
    "kill myself",
    "killing myself",
    "end my life",
    "end it all",
    "want to die",
    "wanna die",
    "better off dead",
    "no reason to live",
    "don't want to live",
    "dont want to live",
    "don't want to wake up",
    "dont want to wake up",
    "self-harm",
    "self harm",
    "hurt myself",
    "harm myself",
    "cut myself",
    "cutting myself",
    "overdose",
    "انتحار",
    "انتحر",
    "أنتحر",
    "اقتل نفسي",
    "أقتل نفسي",
    "اموت نفسي",
    "أموت نفسي",
    "عايز اموت",
    "عاوز اموت",
    "نفسي اموت",
    "أؤذي نفسي",
    "اذي نفسي",
    "أذي نفسي",
    "إيذاء النفس",
    "ايذاء النفس",
    "مش عايز اعيش",
    "مش عاوز اعيش",
    "مش عايز اصحى",
    "اخلص من حياتي",
    "اخلص من نفسي",
    "a2tel nafsy",
    "antehar",
    "3ayez amoot",
)
# Signs of acute distress or harm: also routed to support, never answered generically.
DISTRESS_SCREEN: tuple[str, ...] = (
    "hopeless",
    "worthless",
    "no point in living",
    "can't go on",
    "cant go on",
    "give up on life",
    "hate myself",
    "hate my life",
    "nobody cares",
    "no one cares",
    "panic attack",
    "abuse",
    "abused",
    "abusive",
    "hits me",
    "hit me",
    "beats me",
    "assault",
    "raped",
    "مفيش فايده",
    "مفيش امل",
    "يأس",
    "بكره نفسي",
    "بكره حياتي",
    "مليش لازمه",
    "محدش بيهتم",
    "بيضربني",
    "بتضربني",
    "بيضربوني",
    "اعتداء",
    "تحرش",
)
# Diagnosis, medication, physical symptoms: a professional's job, never answered here.
CLINICAL_SCREEN: tuple[str, ...] = (
    "diagnose",
    "diagnosis",
    "do i have",
    "disorder",
    "depression",
    "depressed",
    "bipolar",
    "schizophren",
    "psychosis",
    "adhd",
    " ocd",
    "ptsd",
    "autism",
    "medication",
    "medicine",
    " meds",
    " pill",
    "tablet",
    " dose",
    "dosage",
    "antidepress",
    "ssri",
    "xanax",
    "valium",
    "prozac",
    "zoloft",
    "melatonin",
    "prescri",
    " pain",
    "chest",
    "heart",
    "blood pressure",
    "fever",
    "tumor",
    "tumour",
    "cancer",
    "seizure",
    "diabet",
    "pregnan",
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
    "حبايه",
    "جرعه",
    "مهدئ",
    "منوم",
    "روشته",
    "وجع",
    " الم ",
    "صداع",
    "قلبي",
    "ضغط الدم",
    " سكر",
    "حامل",
)
# Out of scope for a wellness-education assistant.
SENSITIVE_SCREEN: tuple[str, ...] = (
    " sex",
    "porn",
    "alcohol",
    "drunk",
    " drugs",
    " weed",
    "cocaine",
    "hashish",
    "gambl",
    "weapon",
    " gun",
    "knife",
    "revenge",
    " kill ",
    "مخدرات",
    "حشيش",
    "خمور",
    "سلاح",
    "انتقام",
    "جنس",
)
_PERSONAL_DETAILS = re.compile(
    r"[\w.+-]+@[\w-]+\.[\w.]+"  # e-mail
    r"|https?://|www\.|\.com\b|\.net\b|\.org\b|\.eg\b"  # links
    r"|(?:\+?\d[\s-]?){7,}"  # phone-like digit runs
    r"|(?<![\w@])@\w{2,}"  # handles
)

# --- Topics -------------------------------------------------------------------------------

_BY_ID: dict[str, DemoPrompt] = {p.prompt_id: p for p in DEMO_PROMPTS}

# A typed question is re-expressed as a general question about its topic. Only "stress"
# needs its own wording (the suggestion mentions work); the others reuse the suggestion.
_GENERAL_QUESTION: dict[str, tuple[str, str]] = {
    "stress": (
        "What general techniques can help with stress?",
        "إيه الطرق العامة اللي بتساعد في التعامل مع التوتر؟",
    ),
}

_EN_TOPICS: dict[str, frozenset[str]] = {
    "stress": frozenset(
        "stress stressed stressful tension tense pressure pressured relax relaxing relaxation"
        " calm calming calmer unwind overwhelmed overwhelm burnout nervous anxious anxiety"
        " cope coping".split()
    ),
    "grounding": frozenset("grounding ground grounded senses".split()),
    "habits": frozenset(
        "wellbeing wellness selfcare routine routines habits habit lifestyle balance"
        " productive productivity energy motivation motivated".split()
    ),
    "thoughts": frozenset(
        "thoughts thought feelings emotions emotion emotional worry worries worrying"
        " overthinking overthink rumination ruminating sad sadness angry anger frustrated"
        " frustration lonely loneliness negative".split()
    ),
    "sleep": frozenset(
        "sleep sleeping slept asleep insomnia bedtime bed nap naps rest resting tired".split()
    ),
    "activity": frozenset(
        "physical physically walking walk walks running run sport sports fitness workout"
        " workouts active movement move gym stretching steps".split()
    ),
    "mindfulness": frozenset(
        "mindfulness mindful meditation meditate meditating breathing breath breathe".split()
    ),
}
# Weak words decide only when no strong word is present ("grounding exercise" is grounding;
# "how does exercise help" is physical activity).
_EN_WEAK: dict[str, str] = {
    "exercise": "activity",
    "exercises": "activity",
    "activity": "activity",
    "activities": "activity",
}
# Generic wellbeing words select "everyday habits" only when nothing more specific is
# present ("how does exercise help mental health" is physical activity).
_EN_GENERIC: dict[str, str] = dict.fromkeys(
    "mood mental health healthy happier happy daily wellbeing".split(), "habits"
)

_AR_TOPICS: dict[str, frozenset[str]] = {
    "stress": frozenset(
        "توتر متوتر متوتره ضغط ضغوط مضغوط اجهاد استرخاء ارتاح اهدي هدوء عصبي عصبيه".split()
    ),
    "grounding": frozenset("ارتكاز تاريض".split()),
    "habits": frozenset("عافيه رفاهيه روتين عادات عاده طاقه".split()),
    "thoughts": frozenset("افكار تفكير مشاعر احاسيس عواطف زعل حزن حزين غضب قلق قلقان".split()),
    "sleep": frozenset("نوم انام نايم سهر ارق".split()),
    "activity": frozenset("رياضه نشاط البدني بدني مشي جري حركه جيم".split()),
    "mindfulness": frozenset("يقظه الذهنيه ذهنيه تامل تنفس".split()),
}
_AR_WEAK: dict[str, str] = {
    "تمرين": "activity",
    "تمارين": "activity",
}
_AR_GENERIC: dict[str, str] = dict.fromkeys("نفسيه صحه مزاج يومي".split(), "habits")

_EN_FOLLOW_UPS: dict[str, tuple[str, ...]] = {
    "in-arabic": ("arabic", "egyptian", "colloquial", "dialect", "translate"),
    "continue": (
        "tell me more",
        "more detail",
        "continue",
        "elaborate",
        "go on",
        "expand",
        "explain more",
        "more about",
    ),
    "summary": ("summary", "summarize", "summarise", "sum up", "recap", "in short", "briefly"),
}
_AR_FOLLOW_UPS: dict[str, tuple[str, ...]] = {
    "in-arabic": ("بالعاميه", "عاميه", "بالمصري", "بالعربي", "ترجم"),
    "continue": ("كمل", "نكمل", "اكتر", "اكثر", "تفاصيل", "وضح"),
    "summary": ("ملخص", "لخص", "باختصار"),
}

# Context the re-expressed question may carry: allow-listed, never free text.
_EN_CONTEXT: dict[str, str] = {
    "exam": "exams",
    "exams": "exams",
    "test": "exams",
    "tests": "exams",
    "study": "studying",
    "studying": "studying",
    "university": "studying",
    "college": "studying",
    "school": "studying",
    "work": "work",
    "job": "work",
    "office": "work",
    "day": "everyday life",
    "days": "everyday life",
    "evening": "evenings",
    "evenings": "evenings",
    "night": "evenings",
    "nights": "evenings",
    "morning": "mornings",
    "mornings": "mornings",
    "weekend": "weekends",
    "beginner": "beginners",
    "beginners": "beginners",
    "simply": "simple language",
    "simple": "simple language",
}
_AR_CONTEXT: dict[str, str] = {
    "امتحان": "الامتحانات",
    "امتحانات": "الامتحانات",
    "مذاكره": "الدراسة",
    "دراسه": "الدراسة",
    "جامعه": "الدراسة",
    "كليه": "الدراسة",
    "مدرسه": "الدراسة",
    "شغل": "الشغل",
    "عمل": "الشغل",
    "وظيفه": "الشغل",
    "يوم": "الحياة اليومية",
    "ليل": "بالليل",
    "صبح": "الصبح",
    "مبتدئين": "المبتدئين",
    "ببساطه": "بلغة بسيطة",
    "بسيط": "بلغة بسيطة",
}
MAX_CONTEXT_LABELS = 2

_AR_PREFIXES = ("وبال", "وال", "بال", "لل", "فال", "كال", "ال", "و", "ب", "ل", "ف")
_AR_SUFFIXES = ("هالي", "لي", "ني", "ها", "هم", "ه", "ك", "ات", "ي")
_ARABIC_CHAR = re.compile("[؀-ۿ]")
_ARABIC_WORD = re.compile("[ء-يٱ-ۓ]+")
_LATIN_WORD = re.compile(r"[a-z]+")
_TATWEEL = "ـ"
_RIGHT_QUOTE = "’"


@dataclass(frozen=True)
class GateResult:
    outcome: GateOutcome
    prompt: DemoPrompt | None = None
    language: Language = "en"
    context: tuple[str, ...] = field(default=())
    exact: bool = False  # the message was one of the reviewed questions, word for word

    @property
    def canonical(self) -> str:
        """The reviewed question: used for safety assessment and retrieval."""
        if self.prompt is None:
            raise ValueError("only accepted messages have a canonical question")
        return self.prompt.ar if self.language == "ar" else self.prompt.en

    @property
    def query(self) -> str:
        """What the model is asked: a general question about the topic plus allow-listed
        context labels. Never the user's own sentence."""
        if self.prompt is None:
            raise ValueError("only accepted messages have a query")
        base = self.canonical
        general = _GENERAL_QUESTION.get(self.prompt.prompt_id)
        if general and not self.exact:
            base = general[1] if self.language == "ar" else general[0]
        if not self.context:
            return base
        if self.language == "ar":
            return f"{base} (السياق: {'، '.join(self.context)})"
        return f"{base} (Context: {', '.join(self.context)})"


def _contains(text: str, terms: tuple[str, ...]) -> bool:
    return any(term in text or normalize_arabic(term) in text for term in terms)


def _arabic_forms(word: str) -> list[str]:
    forms = [word]
    for prefix in _AR_PREFIXES:
        if word.startswith(prefix) and len(word) - len(prefix) >= 2:
            forms.append(word[len(prefix) :])
    for form in list(forms):
        for suffix in _AR_SUFFIXES:
            if form.endswith(suffix) and len(form) - len(suffix) >= 2:
                forms.append(form[: -len(suffix)])
    return forms


def _english_forms(word: str) -> list[str]:
    """The word and a few regular inflections removed (stresses, relaxed, sleeping)."""
    forms = [word]
    for suffix in ("ing", "ed", "es", "s"):
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            forms.append(word[: -len(suffix)])
    return forms


def _scan(
    words: list[str],
    topics: dict[str, frozenset[str]],
    weak: dict[str, str],
    context: dict[str, str],
    forms: Callable[[str], list[str]],
) -> tuple[dict[str, int], dict[str, int], list[str]]:
    """Topic scores (strong, weak) and context labels; unknown words are simply ignored."""
    strong: dict[str, int] = {}
    weak_hits: dict[str, int] = {}
    labels: list[str] = []
    for word in words:
        candidates = forms(word)
        matched = {t for t, vocab in topics.items() if any(f in vocab for f in candidates)}
        for topic in matched:
            strong[topic] = strong.get(topic, 0) + 1
        if not matched:
            for f in candidates:
                if f in weak:
                    weak_hits[weak[f]] = weak_hits.get(weak[f], 0) + 1
                    break
        for f in candidates:
            label = context.get(f)
            if label and label not in labels:
                labels.append(label)
                break
    return strong, weak_hits, labels


def _pick(scores: dict[str, int]) -> str | None:
    """The single highest-scoring topic, "tie" if two lead, None if nothing scored."""
    if not scores:
        return None
    best = max(scores.values())
    leaders = [t for t, n in scores.items() if n == best]
    return leaders[0] if len(leaders) == 1 else "tie"


def _merge(a: dict[str, int], b: dict[str, int]) -> dict[str, int]:
    return {t: a.get(t, 0) + b.get(t, 0) for t in {*a, *b}}


def classify(message: str, earlier_intents: list[str]) -> GateResult:
    """Decide whether a typed message is a supported educational question (fail-closed:
    anything not positively placed in one topic is refused)."""
    text = " ".join(message.split())
    if len(text) > MAX_TYPED_CHARS:
        return GateResult("too_long")
    is_arabic = bool(_ARABIC_CHAR.search(text))
    language: Language = "ar" if is_arabic else "en"
    lowered = text.casefold().replace(_RIGHT_QUOTE, "'")
    folded = normalize_arabic(lowered.replace(_TATWEEL, ""))
    padded = f" {re.sub(r'[^\w\s\'@.+-]', ' ', folded)} "

    if _contains(padded, CRISIS_SCREEN) or _contains(padded, DISTRESS_SCREEN):
        return GateResult("crisis", language=language)
    if _PERSONAL_DETAILS.search(lowered):
        return GateResult("personal_details", language=language)
    if _contains(padded, CLINICAL_SCREEN):
        return GateResult("clinical", language=language)
    if _contains(padded, SENSITIVE_SCREEN):
        return GateResult("sensitive", language=language)

    # The reviewed questions themselves (the suggestions), in either language.
    for prompt in DEMO_PROMPTS:
        for candidate, lang in ((prompt.en, "en"), (prompt.ar, "ar")):
            if normalize(candidate) == normalize(text):
                if prompt.follow_up and not earlier_intents:
                    return GateResult("needs_context", language=language)
                chosen: Language = "ar" if lang == "ar" else "en"
                return GateResult("accept", prompt, chosen, exact=True)

    latin = _LATIN_WORD.findall(lowered.replace("-", ""))
    arabic = _ARABIC_WORD.findall(folded)
    en_strong, en_weak, en_ctx = _scan(latin, _EN_TOPICS, _EN_WEAK, _EN_CONTEXT, _english_forms)
    ar_strong, ar_weak, ar_ctx = _scan(arabic, _AR_TOPICS, _AR_WEAK, _AR_CONTEXT, _arabic_forms)
    _, en_generic, _ = _scan(latin, {}, _EN_GENERIC, {}, _english_forms)
    _, ar_generic, _ = _scan(arabic, {}, _AR_GENERIC, {}, _arabic_forms)
    labels = tuple((ar_ctx if is_arabic else en_ctx)[:MAX_CONTEXT_LABELS])

    follow = [
        intent
        for intent, phrases in (_AR_FOLLOW_UPS if is_arabic else _EN_FOLLOW_UPS).items()
        if _contains(padded, phrases)
    ]
    if "in-arabic" in follow and not is_arabic:
        language = "ar"

    topic = (
        _pick(_merge(en_strong, ar_strong))
        or _pick(_merge(en_weak, ar_weak))
        or _pick(_merge(en_generic, ar_generic))
    )
    if topic == "tie":
        return GateResult("multiple_topics", language=language)
    if topic is not None:
        return GateResult("accept", _BY_ID[topic], language, context=labels)
    if follow:
        if not earlier_intents:
            return GateResult("needs_context", language=language)
        intent = follow[0]
        return GateResult("accept", _BY_ID[intent], "ar" if intent == "in-arabic" else language)
    return GateResult("unsupported", language=language)


SUPPORTED_TOPICS: tuple[str, ...] = tuple(p.prompt_id for p in DEMO_PROMPTS if not p.follow_up)
