"""Understand a message for one assistant (structured mode, D-56).

Order, all before any limit, retrieval or model call:

1. **Risk screens**, independent of topic: crisis and distress go to support; signs of
   abuse, threats or control go to a safety-focused support response in every assistant.
   Personal details (contact data, links) are refused; diagnosis and medication are
   refused for every assistant; regulated advice (investment, tax, legal) is refused with
   a pointer to a professional; sexual content, substances and weapons are out of scope.
   Pregnancy danger signs go to urgent care. In Fitness, pregnancy, type-2 diabetes and
   high blood pressure get WHO's guidance built locally (D-63); injuries, pain and other
   conditions go to a clinician. Low mood is answered with a pointer to a professional.
2. **Routing, never gating (D-62)**: the assistant's lexicon finds up to three specific
   concerns; failing that, a follow-up, related wording, another assistant's lexicon (with
   a handoff suggestion) or an approved secondary domain. With nothing recognised the
   outcome is "clarify": the service looks for a clearly matching passage and otherwise
   asks for a little more. Topic alone never refuses.
3. **Composed question**: "In a marriage ..., what are practical ways to <concern 1>,
   <concern 2> and <concern 3>?" plus allow-listed context labels. This, never the user's
   own sentence, is what the model sees in structured mode. Personal details are dropped.

Engineering keyword screens: they miss indirect wording and are not a clinical
assessment (see OPEN_DECISIONS D-52/D-56).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from app.assistants.conditions import Condition
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
    "medical",
    "danger",
    "personal_details",
    "clinical",
    "regulated",
    "sensitive",
    "clarify",  # nothing recognisable yet: ask, never refuse (P0, 2026-10-25)
    "too_long",
]
# How an accepted message was matched (logged; never the text).
Route = Literal["own", "follow_up", "related", "borrowed", "condition", "none"]
Caution = Literal["low_mood"]
MAX_SUBTOPICS = 3
# Related-wording match: distinct content stems shared with a subtopic's description.
_MIN_RELATED_OVERLAP = 2

_HARM_IN_RELATIONSHIPS = (
    "abuse",
    "abused",
    "abusive",
    "hits me",
    "hit me",
    "beats me",
    "slaps me",
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
    "with a belt",
    "with his belt",
    "with her belt",
    "بالحزام",
    "بالخرزانه",
    "doesn't allow me to leave",
    "doesnt allow me to leave",
    "won't allow me",
    "not allowed to leave",
    "checks my phone",
    "reads my messages",
    "reads all my messages",
    "decides who i can",
    "who i can talk to",
    "who i can see",
    "won't let me talk",
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
    "يمنعني من",
    "بيمنعني من",
    "تمنعني من",
    "يراقب هاتفي",
    "بيراقب تليفوني",
    "بيفتش تليفوني",
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
# Diagnosis and medication: refused in every assistant. Mood words ("depressed", "low")
# are not here: feeling low is answered supportively, with a pointer to a professional
# if it lasts (see _LOW_MOOD), and a request for a diagnosis is caught by _CONDITION_CHECK.
_CLINICAL = (
    "diagnose",
    "diagnosis",
    "disorder",
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
_CONDITION_CHECK = re.compile(
    r"\b(?:do|could|might|may)\s+i\s+have\s+(?:an?\s+)?(?:\w+\s+)?(?:disorder|syndrome|condition|"
    r"illness|anxiety|depression|adhd|ocd|ptsd|autism|bipolar)\b|"
    r"\bam\s+i\s+(?:clinically\s+)?(?:depressed|bipolar|autistic|mentally\s+ill)\b",
    re.IGNORECASE,
)
# Fitness: products and conditions that need a clinician, never general guidance.
_FITNESS_MEDICAL = (
    "eating disorder",
    "anorexi",
    "bulimi",
    "steroid",
    "supplement",
    "مكملات",
)
# Health conditions (D-63). Pregnancy and the chronic conditions WHO gives activity
# guidance for (type-2 diabetes, high blood pressure) get that guidance, built locally in
# Fitness: the condition is health data and never goes to the provider. Injuries, pain and
# other conditions are questions for a clinician.
_PREGNANCY = re.compile(
    r"\b(?:pregnan\w*|postpartum|post-partum|after\s+giving\s+birth|gave\s+birth|"
    r"expecting\s+a\s+baby)\b",
    re.IGNORECASE,
)
_PREGNANCY_AR = ("حامل", "فتره الحمل", "اثناء الحمل", "في الحمل", "شهور الحمل", "بعد الولاده")
# In pregnancy these mean urgent care, never guidance.
_PREGNANCY_DANGER = re.compile(
    r"\b(?:bleed\w*|spotting|contraction\w*|fluid|leak\w*|dizz\w*|faint\w*|headaches?|"
    r"swelling|swollen|(?:baby|it)\s+(?:isn't|is\s+not|not|stopped)\s+moving|"
    r"reduced\s+movements?)\b",
    re.IGNORECASE,
)
_PREGNANCY_DANGER_AR = frozenset(
    ("نزيف", "دم", "انقباضات", "طلق", "دوخه", "دايخه", "صداع", "تورم", "ورم")
)
_PREGNANCY_DANGER_AR_PHRASES = ("مش بيتحرك", "مبيتحركش", "نزول ميه", "بينزل ميه")
_CHRONIC = re.compile(
    r"\b(?:(?:type[\s-]*(?:2|two|ii)\s+)?diabet\w*|high\s+blood\s+pressure|hypertension)\b",
    re.IGNORECASE,
)
_CHRONIC_AR = (
    "السكري",
    "مرض السكر",
    "عندي سكر",
    "مريض سكر",
    "مريضه سكر",
    "ضغط عالي",
    "الضغط العالي",
    "ضغط الدم",
    "مريض ضغط",
    "مريضه ضغط",
    "عندي ضغط",
)
_OTHER_HEALTH = re.compile(
    r"\b(?:injur\w*|sprain\w*|fractur\w*|pain(?:s|ful)?|heart\s+(?:condition|disease|problem)|"
    r"asthma|arthritis|type[\s-]*(?:1|one|i)\s+diabet\w*|surgery|operation)\b",
    re.IGNORECASE,
)
_OTHER_HEALTH_AR = ("اصابه", "اتصابت", "وجع", " الم ", "بيوجعني", "بتوجعني", "عمليه", "النوع الاول")
_ACTIVITY = re.compile(
    r"\b(?:walk\w*|exercis\w*|active|activity|activities|workouts?|work\s+out|gym|run\w*|"
    r"jog\w*|swim\w*|yoga|pilates|train\w*|sports?|move|moving|fit|fitness|stretch\w*|"
    r"strength|cardio|weights?)\b",
    re.IGNORECASE,
)
_ACTIVITY_AR = frozenset(
    (
        "مشي",
        "امشي",
        "بمشي",
        "رياضه",
        "تمارين",
        "تمرين",
        "اتمرن",
        "جيم",
        "اجري",
        "جري",
        "نشاط",
        "حركه",
        "اتحرك",
        "سباحه",
        "يوجا",
        "رياضي",
    )
)
# Low mood mentioned: answered, with a pointer to a professional if it lasts.
_LOW_MOOD = re.compile(r"\b(?:depressed|depression|depressing)\b", re.IGNORECASE)
_LOW_MOOD_AR = ("اكتئاب", "مكتئب")
# Word-bounded so "invest more time", "shares everything", "taxi" or "courtesy" are not
# read as investment, tax or legal questions.
_REGULATED = re.compile(
    r"\binvest(?:ing|ment|ments|or|ors|ed)?\b(?!\s+(?:more\s+|some\s+|a\s+lot\s+of\s+|my\s+|our\s+)?"
    r"(?:time|energy|effort|myself|yourself|ourselves|in\s+(?:myself|yourself|ourselves|my\s+self|"
    r"my\s+(?:health|relationship|marriage|family|skills|career|friendships?|future|growth))))|"
    r"\b(?:stocks|stock\s+market|buy\s+shares|sell\s+shares|shares\s+in|crypto\w*|bitcoin|forex|"
    r"day\s+trading|trading\s+(?:account|platform|app)|tax|taxes|lawyer|attorney|lawsuit|court|"
    r"custody|legal|legally|sue|suing|labou?r\s+law|egyptian\s+law|under\s+the\s+law|"
    r"the\s+law\s+says?|alimony|inheritance|property\s+split)\b",
    re.IGNORECASE,
)
_REGULATED_AR = (
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
_SENSITIVE = re.compile(
    r"\b(?:sex|sexual|sexually|porn\w*|drugs|weed|cocaine|hashish|gambl\w*|weapons?|guns?|"
    r"revenge(?!\s+(?:bedtime\s+)?procrastination))\b",
    re.IGNORECASE,
)
_SENSITIVE_AR = (
    "مخدرات",
    "حشيش",
    "سلاح",
    "انتقام",
    "جنس",
)
# --- Risk patterns (D-60): grammar-like patterns, not only fixed phrases ---------------
# Someone doing physical harm TO the person (or their children). "beat me at chess" and
# "kick me out of the meeting" style uses are excluded where the object or context shows it.
_VIOLENCE = re.compile(
    r"\b(?:hit|hits|hitting|beat|beats|beating|slap(?:s|ped|ping)?|punch(?:es|ed|ing)?|"
    r"kick(?:s|ed|ing)?|chok(?:e|es|ed|ing)|strangl(?:e|es|ed|ing)|burn(?:s|ed|t)|"
    r"bit|bites|shov(?:e|es|ed)|threaten(?:s|ed|ing)?|rap(?:e|es|ed|ing))\s+"
    r"(?:me|us|my\s+(?:(?:little|younger|older|baby|big)\s+)?"
    r"(?:kids?|children|son|daughter|baby|mother|mum|mom|sister|brother|wife|husband))\b"
    r"(?!\s+(?:at|in|on|out\s+of\s+(?:the|a)\s+(?:game|match|meeting|team|group)))",
    re.IGNORECASE,
)
_SEXUAL_VIOLENCE = (
    "raped",
    "rape me",
    "sexual assault",
    "sexually assaulted",
    "sexual harassment",
    "sexually harass",
    "forced me to have sex",
    "forces me to have sex",
    "touched me without",
    "molest",
    "اغتصب",
    "اعتداء جنسي",
    "اتحرش بيا",
    "اتحرش بي",
    "غصبني",
)
# Threats and immediate danger from someone else. Not "will kill me" / "gonna kill me",
# which are everyday idioms ("my boss will kill me if I'm late").
_THREATS = (
    "threatened to kill",
    "threatens to kill",
    "said he would kill",
    "said she would kill",
    "trying to kill me",
    "has a knife",
    "with a knife",
    "has a gun",
    "locked me in",
    "locks me in",
    "هيقتلني",
    "هددني بالقتل",
    "بيهددني بالقتل",
    "معاه سكينه",
    "قفل علي الباب",
)
# Harm the person may do to someone else, or a request for means to do it.
_DANGER = (
    "kill him",
    "kill her",
    "kill them",
    "hurt him badly",
    "hurt her badly",
    "make a bomb",
    "build a bomb",
    "poison him",
    "poison her",
    "poison someone",
    "اقتله",
    "اقتلها",
    "اموته",
    "اسممه",
    "اسممها",
)
# Possible medical emergencies: urgent care, never general guidance.
_MEDICAL_EMERGENCY = (
    "chest pain",
    "pain in my chest",
    "can't breathe",
    "cannot breathe",
    "cant breathe",
    "trouble breathing",
    "struggling to breathe",
    "passed out",
    "fainted",
    "unconscious",
    "heart attack",
    "having a stroke",
    "seizure",
    "severe bleeding",
    "bleeding heavily",
    "been poisoned",
    "وجع في صدري",
    "الم في صدري",
    "مش قادر اتنفس",
    "مش عارف اتنفس",
    "اغمي علي",
    "فقد الوعي",
    "نزيف",
    "جلطه",
    "تشنجات",
    "اتسمم",
)
# Family: a parent talking WITH children about substances or sex is in scope.
_KIDS_TALK = (
    "talk to my",
    "talk with my",
    "conversation with my",
    "teen",
    "my son",
    "my daughter",
    "my kids",
    "my children",
    "my child",
    "اكلم ابني",
    "اكلم بنتي",
    "اتكلم مع ولادي",
    "ابني",
    "بنتي",
    "ولادي",
    "مراهق",
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
# Egyptian present, future and negated verbs: "بتتجاهل" -> "تجاهل", "هيسافر" -> "سافر",
# "مبتردش" -> "رد". The stem must keep at least three letters.
_AR_VERB_PREFIXES = (
    "مبيت",
    "مبتت",
    "بيت",
    "بتت",
    "بنت",
    "هيت",
    "هتت",
    "مبي",
    "مبت",
    "مبن",
    "بي",
    "بت",
    "بن",
    "با",
    "هي",
    "هت",
    "هن",
    "ها",
)
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
    route: Route = "none"
    caution: Caution | None = None  # an extra instruction for the model, never shown
    suggestions: tuple[Subtopic, ...] = ()  # with "clarify": closest concerns to offer
    condition: Condition | None = None  # route "condition": WHO guidance built locally

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


def _has_word(text: str, words: frozenset[str]) -> bool:
    """Whole Arabic words (with their prefixes and suffixes), not substrings: "دم" must
    not match inside "خدمه"."""
    folded = normalize_arabic(text.casefold())
    return any(_ar_forms(w) & words for w in _ARABIC_WORD.findall(folded))


def _ar_forms(word: str) -> set[str]:
    forms = {word}
    for p in _AR_PREFIXES:
        if word.startswith(p) and len(word) - len(p) >= 2:
            forms.add(word[len(p) :])
    for p in _AR_VERB_PREFIXES:
        if word.startswith(p) and len(word) - len(p) >= 3:
            forms.add(word[len(p) :])
    if word.endswith("ش") and len(word) >= 5:  # negation: "مبيسمعنيش"
        forms |= {f[:-1] for f in list(forms) if f.endswith("ش")}
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


# --- Related wording (P0, 2026-10-25) ----------------------------------------------------
# A message with none of a subtopic's trigger words can still share its meaning: content
# words are compared, stem to stem, with each subtopic's own description and search terms.
def _words(text: str) -> frozenset[str]:
    return frozenset(text.split())


_STOPWORDS = _words(
    "the and for are was were been have has had not but too also because than then its "
    "how what can could would should will get got make made does did doing help way ways "
    "feel feeling feels want wants need needs really lot lots thing things about with without "
    "every always never more less better best good bad people someone still just like know "
    "think try trying keep stop start practical each other their they them this that these "
    "those there when where which while from into over after before again very much many "
    "some any all one our your you his her him she and lately anymore even ever since "
    "whether who why yes okay any idea ideas tips advice tell please able something anything"
)
_STOPWORDS_AR = _words(
    "انا انت انتي احنا هو هي هم عايز عاوز عايزه ازاي ايه ليه مش في من علي عن مع كل بس ده "
    "دي اللي لما كان يكون حاجه او لو كيف ماذا هل ان الي هذا هذه التي الذي جدا اوي خالص كده "
    "برضه بقي ممكن اعمل نعمل عشان علشان لان حد طب يعني"
)
_EN_SUFFIXES = ("ation", "tion", "ment", "ness", "ing", "ers", "er", "ed", "es", "ly", "s", "e")


def _stem(word: str) -> str:
    for suffix in _EN_SUFFIXES:
        if word.endswith(suffix) and len(word) - len(suffix) >= 3:
            word = word[: -len(suffix)]
            break
    return word[:6]


def _en_stems(text: str) -> set[str]:
    return {
        _stem(w)
        for w in _LATIN_WORD.findall(text.casefold().replace("*", "").replace("_", " "))
        if len(w) >= 3 and w not in _STOPWORDS
    }


def _ar_word_forms(text: str) -> list[set[str]]:
    folded = normalize_arabic(text.casefold().replace("_", " "))
    return [_ar_forms(w) for w in _ARABIC_WORD.findall(folded) if w not in _STOPWORDS_AR]


def _bag(sub: Subtopic) -> tuple[set[str], set[str]]:
    en = _en_stems(" ".join((sub.phrase_en, sub.search_en, *sub.en)))
    ar: set[str] = set()
    for forms in _ar_word_forms(" ".join((sub.phrase_ar, sub.search_ar, *sub.ar))):
        ar |= forms
    return en, ar


_BAGS: dict[str, tuple[tuple[Subtopic, set[str], set[str]], ...]] = {
    domain: tuple((sub, *_bag(sub)) for sub in subs) for domain, subs in LEXICON.items()
}


def related_subtopics(assistant_id: str, text: str) -> list[tuple[Subtopic, int]]:
    """Subtopics whose description shares content words with the message, best first."""
    en = _en_stems(text)
    ar = _ar_word_forms(text)
    scored = []
    for sub, bag_en, bag_ar in _BAGS.get(assistant_id, ()):
        n = len(en & bag_en) + sum(1 for forms in ar if forms & bag_ar)
        if n:
            scored.append((sub, n))
    scored.sort(key=lambda pair: -pair[1])
    return scored


def _best_other(assistant: Assistant, text: str, own_score: int) -> str | None:
    best, best_score = None, own_score
    for other in ASSISTANTS:
        if other.assistant_id in (assistant.assistant_id, "everyday"):
            continue
        score = sum(n for _, n in score_subtopics(other.assistant_id, text))
        if score >= best_score + 2:  # clearly a better fit, not a tie
            best, best_score = other.assistant_id, score
    return best


def _borrow(assistant: Assistant, text: str) -> tuple[str, list[Subtopic]] | None:
    """Another assistant's lexicon recognises the concern: its specific (signal) subtopics,
    asked in this assistant's frame. A single trigger word ("month", "money") is too weak
    a reason to change the topic, so at least two are needed. Approved secondary domains
    win ties."""
    best: tuple[int, bool, str, list[Subtopic]] | None = None
    for other in ASSISTANTS:
        if other.assistant_id == assistant.assistant_id:
            continue
        scored = [(s, n) for s, n in score_subtopics(other.assistant_id, text) if s.signal]
        approved = other.assistant_id in assistant.secondary_domains
        if sum(n for _, n in scored) < 2:
            continue
        rank = (sum(n for _, n in scored), approved)
        if best is None or rank > best[:2]:
            best = (*rank, other.assistant_id, [s for s, _ in scored])
    return (best[2], best[3]) if best else None


def _related_secondary(assistant: Assistant, text: str) -> tuple[str, list[Subtopic]] | None:
    """Related wording in the approved secondary domains. Not in other assistants: shared
    words alone are too weak there, and asking beats answering the wrong question."""
    for domain in assistant.secondary_domains:
        related = [
            (s, n)
            for s, n in related_subtopics(domain, text)
            if n >= _MIN_RELATED_OVERLAP and s.signal
        ]
        if related:
            return domain, [s for s, _ in related]
    return None


def understand(assistant: Assistant, message: str, has_history: bool) -> Understanding:
    aid = assistant.assistant_id
    text = " ".join(message.split())
    is_arabic = bool(_ARABIC_CHAR.search(text))
    language: Literal["en", "ar"] = "ar" if is_arabic else "en"
    if len(text) > MAX_TYPED_CHARS:
        return Understanding("too_long", aid, language)
    lowered = text.casefold().replace("’", "'")
    padded = f" {normalize_arabic(lowered)} "

    # --- 1. Safety, independent of topic: always first, never skipped by the routing ---
    if _has(padded, CRISIS_SCREEN):
        return Understanding("crisis", aid, language)
    # Being hurt, threatened or controlled: a safety-focused support response in every
    # assistant (resources for abuse, never a refusal).
    if (
        _has(padded, _HARM_IN_RELATIONSHIPS)
        or _has(padded, _SEXUAL_VIOLENCE)
        or _has(padded, _THREATS)
        or _VIOLENCE.search(text)
    ):
        return Understanding("relationship_safety", aid, language)
    if _has(padded, _DANGER):
        return Understanding("danger", aid, language)
    if _has(padded, _MEDICAL_EMERGENCY):
        return Understanding("medical", aid, language)
    pregnancy = bool(_PREGNANCY.search(text)) or _has(padded, _PREGNANCY_AR)
    if pregnancy and (
        _PREGNANCY_DANGER.search(text)
        or _has_word(text, _PREGNANCY_DANGER_AR)
        or _has(padded, _PREGNANCY_DANGER_AR_PHRASES)
    ):
        return Understanding("medical", aid, language)
    if _has(padded, DISTRESS_SCREEN):
        return Understanding("crisis", aid, language)
    if _PERSONAL_DETAILS.search(lowered):
        return Understanding("personal_details", aid, language)
    # --- 2. Harmful or professional-only requests: refused with a pointer ---
    if (
        _has(padded, _CLINICAL)
        or _CONDITION_CHECK.search(text)
        or (aid == "fitness" and _has(padded, _FITNESS_MEDICAL))
    ):
        return Understanding("clinical", aid, language)
    if _REGULATED.search(text) or _has(padded, _REGULATED_AR):
        return Understanding("regulated", aid, language)
    sensitive = (_SENSITIVE.search(text) is not None or _has(padded, _SENSITIVE_AR)) and not (
        aid == "family" and _has(padded, _KIDS_TALK)
    )
    if sensitive or _INJECTION.search(text):
        return Understanding("sensitive", aid, language)
    if aid == "fitness":
        chronic = bool(_CHRONIC.search(text)) or _has(padded, _CHRONIC_AR)
        if _OTHER_HEALTH.search(text) or _has(padded, _OTHER_HEALTH_AR):
            return Understanding("clinical", aid, language)
        if pregnancy or chronic:
            if not (_ACTIVITY.search(text) or _has_word(text, _ACTIVITY_AR)):
                return Understanding("clinical", aid, language)  # diet, symptoms, medicines
            return Understanding(
                "accept",
                aid,
                language,
                route="condition",
                condition="pregnancy" if pregnancy else "chronic",
            )
    caution: Caution | None = (
        "low_mood" if _LOW_MOOD.search(text) or _has(padded, _LOW_MOOD_AR) else None
    )

    follow_tables = _FOLLOW_AR if is_arabic else _FOLLOW_EN
    follow = next((k for k, phrases in follow_tables.items() if _has(padded, phrases)), None)
    if follow == "in-arabic":
        language = "ar"

    # --- 3. Routing: where the knowledge comes from, never whether to answer ---
    scored = score_subtopics(aid, text)
    own_score = sum(n for _, n in scored)
    handoff = _best_other(assistant, text, own_score)
    route: Route = "own"
    subtopics = [s for s, _ in scored]
    borrowed_from: str | None = None
    if not subtopics:
        if follow and has_history:
            question = _FOLLOW_QUESTION[follow][1 if language == "ar" else 0]
            return Understanding(
                "accept", aid, language, question=question, follow_up=follow, route="follow_up"
            )
        related = [s for s, n in related_subtopics(aid, text) if n >= _MIN_RELATED_OVERLAP]
        borrowed = (
            None if related else _borrow(assistant, text) or _related_secondary(assistant, text)
        )
        if related:
            route, subtopics = "related", related
        elif borrowed is not None:
            borrowed_from, subtopics = borrowed
            route = "related" if borrowed_from == aid else "borrowed"
    if not subtopics:
        closest = tuple(s for s, _ in related_subtopics(aid, text)[:MAX_SUBTOPICS])
        return Understanding(
            "clarify", aid, language, handoff=handoff, suggestions=closest or LEXICON[aid][:3]
        )

    chosen = tuple(subtopics[:MAX_SUBTOPICS])
    context = _context_labels(text, is_arabic)
    # Secondary domains are searched only when the message explicitly touches them; a
    # borrowed concern is searched in its own domain only if that domain is approved.
    secondary = tuple(
        d
        for d in assistant.secondary_domains
        if d == borrowed_from or any(sub.signal for sub, _ in score_subtopics(d, text))
    )
    if borrowed_from and borrowed_from != aid and borrowed_from not in assistant.secondary_domains:
        handoff = handoff or (borrowed_from if borrowed_from != "everyday" else None)
    return Understanding(
        "accept",
        aid,
        language,
        subtopics=chosen,
        context=context,
        question=compose(assistant, chosen, language, context),
        handoff=handoff,
        secondary_domains=secondary,
        route=route,
        caution=caution,
    )


# --- Evidence route (P0): nothing recognised, but a public passage clearly matches -------
# Local retrieval with the (redacted) words finds the passage; the provider then gets the
# passage and this fixed question, never the user's words (structured mode).
MIN_EVIDENCE_OVERLAP = 2


def evidence_question(assistant: Assistant, language: str) -> str:
    if language == "ar":
        return f"{assistant.frame_ar} تطبق النصايح اللي في المصادر دي على موقف يومي؟"
    return (
        f"{assistant.frame_en} apply the guidance in the provided passages to an everyday "
        "situation?"
    )


def evidence_overlap(message: str, passage: str) -> int:
    """Distinct content words of the message that the passage also uses."""
    en = len(_en_stems(message) & _en_stems(passage))
    passage_forms: set[str] = set()
    for forms in _ar_word_forms(passage):
        passage_forms |= forms
    return en + sum(1 for forms in _ar_word_forms(message) if forms & passage_forms)


# Extra instructions for the model when the message mentions low mood. Fixed text;
# nothing from the message is added.
CAUTION_INSTRUCTIONS: dict[str, str] = {
    "low_mood": (
        "The person mentioned feeling depressed or low. Respond warmly and supportively, "
        "never diagnose, and gently suggest speaking to a doctor or mental-health "
        "professional if the low mood lasts more than two weeks or makes daily life hard."
    ),
}


# A message with nothing recognised continues the earlier situation (structured
# follow-up) when it refers back to it or speaks about the person's own situation ("What
# should I do when I miss a day?"). An impersonal question in the middle of a chat ("What
# is the capital of France?") is not a follow-up: it gets the evidence step or "clarify".
_REFERS_BACK_EN = re.compile(
    r"\b(?:it|that|this|those|these|them|then|else|more|also|and|again|instead|first|next|"
    r"which|one|step|steps|what\s+if|how\s+about|why|start|i|i'm|i've|me|my|we|we're|us|our)\b",
    re.IGNORECASE,
)
_REFERS_BACK_AR = frozenset(
    (
        "ده",
        "دي",
        "دول",
        "كده",
        "طب",
        "وبعدين",
        "بعدين",
        "كمان",
        "تاني",
        "لو",
        "ليه",
        "اول",
        "ابدا",
        "انا",
        "احنا",
        "عندي",
        "اعمل",
        "نعمل",
    )
)
_SHORT_FOLLOW_UP_WORDS = 3


def refers_back(message: str) -> bool:
    text = " ".join(message.split())
    if len(text.split()) <= _SHORT_FOLLOW_UP_WORDS or _REFERS_BACK_EN.search(text):
        return True
    words = _ARABIC_WORD.findall(normalize_arabic(text.casefold()))
    return any(_ar_forms(w) & _REFERS_BACK_AR for w in words)
