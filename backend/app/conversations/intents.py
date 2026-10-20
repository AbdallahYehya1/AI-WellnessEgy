"""Fail-closed gate for typed chat messages (OPEN_DECISIONS D-53).

The chat accepts typed text, but only questions that can be reliably recognised as one
of the reviewed, low-risk educational topics in `demo.DEMO_PROMPTS`. The gate is
deterministic and deliberately narrow:

1. The engineering crisis screen runs first; a match is routed to the support
   response, never to generation.
2. The exact reviewed questions (the suggestions) are always recognised.
3. Otherwise EVERY word must belong to a closed vocabulary of question words, neutral
   wellness words and topic words, in English or Arabic (Egyptian or Modern Standard).
   One unknown word (a name, a symptom, "I feel", "can't", a medication, a number,
   Arabizi) and the message is refused. Personal disclosures almost always contain such
   words, so they are refused rather than interpreted.
4. The words must point to exactly one reviewed topic (or a follow-up of an earlier
   recognised question).

An accepted message is replaced by its canonical reviewed question. Only that
canonical question, never the user's own words, is used for safety assessment,
retrieval and the model request, so typed personal text never reaches Groq even if the
gate were to accept something it shouldn't.

This is an engineering control, NOT a clinical risk assessment, and it is not a
general conversational assistant: it maps typed questions onto a fixed set of topics.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal

from app.conversations.demo import DEMO_PROMPTS, DemoPrompt, normalize
from app.knowledge.retrieval import normalize_arabic

MAX_TYPED_CHARS = 300
MAX_WORDS = 30

GateOutcome = Literal[
    "accept", "crisis", "unsupported", "multiple_topics", "needs_context", "too_long"
]
Language = Literal["en", "ar"]

# Engineering safety net shared with the test assessor. NOT clinical; it can only make
# the gate more cautious (any match goes to the support response).
CRISIS_SCREEN: tuple[str, ...] = (
    "suicide",
    "suicidal",
    "kill myself",
    "end my life",
    "want to die",
    "wanna die",
    "self-harm",
    "self harm",
    "hurt myself",
    "harm myself",
    "cut myself",
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
    "a2tel nafsy",
    "antehar",
)

_BY_ID: dict[str, DemoPrompt] = {p.prompt_id: p for p in DEMO_PROMPTS}

# --- English ---------------------------------------------------------------------------

_EN_NEUTRAL = frozenset(
    """
    what s how why which is are can could would will should do does you your me i my we our
    us people a an the some any of for to with and or about in on at during before after it
    its this that these those there please thanks thank explain describe define tell give
    share show suggest recommend list teach learn know understand mean means meaning
    definition help helps helping helpful improve improving support supports supporting
    build practice practise practices try use get make start more most better best good
    healthy healthier simple easy quick basic short brief general everyday daily common few
    tips tip ways way steps step ideas advice guide guidance techniques technique strategies
    strategy methods method benefits benefit effect effects work works role important matter
    matters overall mental wellbeing well being wellness health mind body emotional routine
    routines habits habit lifestyle example examples beginner beginners cope coping manage
    managing deal dealing handle handling reduce reducing difficult hard negative positive
    exercise exercises activity activities kind kinds type types something things thing
    really actually again also just like night nights evening morning day days
    """.split()
)

# Strong topic words: any one of them selects the topic.
_EN_TOPICS: dict[str, frozenset[str]] = {
    "stress": frozenset(
        "stress stressed stressful tension pressure relax relaxing relaxation calm calming"
        " unwind".split()
    ),
    "grounding": frozenset("grounding ground".split()),
    "habits": frozenset("wellbeing wellness selfcare".split()),
    "thoughts": frozenset(
        "thoughts thought feelings emotions emotion worry worries worrying overthinking"
        " rumination".split()
    ),
    "sleep": frozenset("sleep sleeping bedtime bed nap naps rest resting".split()),
    "activity": frozenset(
        "physical physically walking walk sport sports fitness workout active movement"
        " running".split()
    ),
    "mindfulness": frozenset(
        "mindfulness mindful meditation meditate meditating breathing breath".split()
    ),
}
# Weak words select a topic only when no strong word is present ("grounding exercise"
# is grounding; "how does exercise help" is physical activity).
_EN_WEAK: dict[str, str] = {
    "exercise": "activity",
    "exercises": "activity",
    "activity": "activity",
    "activities": "activity",
    "habits": "habits",
    "habit": "habits",
    "routine": "habits",
    "routines": "habits",
    "lifestyle": "habits",
}
# Generic words select "everyday habits that support wellbeing" only when nothing more
# specific is present ("how does exercise help mental health" is physical activity).
_EN_GENERIC = frozenset("mental health well being".split())

_EN_FOLLOW_UPS: dict[str, frozenset[str]] = {
    "in-arabic": frozenset("arabic egyptian colloquial dialect translate translation".split()),
    "continue": frozenset("continue more further elaborate expand detail details go on".split()),
    "summary": frozenset("summary summarize summarise summarized sum up recap".split()),
}

# --- Arabic (normalised spelling: alef forms, alef maqsura and teh marbuta unified) ------

_AR_NEUTRAL = frozenset(
    """
    ايه اي ازاي كيف ليه لماذا ما ماذا هي هو هل ممكن يمكن تقدر تشرح تشرحلي اشرح اشرحلي
    تقول تقولي قولي تديني اديني تعطيني اعطني عايز عاوز حابب اعرف افهم اتعلم عن في من على
    علي الى الي مع او اللي الذي التي لي ليا يعني معني تعريف فايده فوايد فوائد نصايح نصائح
    نصيحه طرق طريقه خطوات بسيط بسيطه سهل سهله سريع سريعه يومي يوميه عامه عام احسن افضل
    كويس كويسه صحي صحيه الصحه صحه النفسيه نفسيه العقليه الجسم الجسديه بيساعد بتساعد تساعد
    يساعد يحسن تحسين اتعامل التعامل ادير اداره بتفيد تفيد يفيد مفيد اهميه مهم دور تاثير دي
    ده دا هذه هذا شويه حاجه حاجات امثله مثال للمبتدئين شرح عادات عاده روتين تمرين تمارين
    الصعبه صعبه السلبيه سلبيه بشكل اعمل نعمل اقلل تقليل بالليل الليل ليل الصبح يوم
    """.split()
)
_AR_TOPICS: dict[str, frozenset[str]] = {
    "stress": frozenset("توتر متوتر ضغط ضغوط اجهاد استرخاء اهدي هدوء".split()),
    "grounding": frozenset("ارتكاز تاريض".split()),
    "habits": frozenset("عافيه رفاهيه".split()),
    "thoughts": frozenset("افكار مشاعر احاسيس عواطف قلق".split()),
    "sleep": frozenset("نوم انام سهر".split()),
    "activity": frozenset("رياضه نشاط البدني بدني مشي حركه".split()),
    "mindfulness": frozenset("يقظه الذهنيه ذهنيه تامل تنفس".split()),
}
_AR_WEAK: dict[str, str] = {
    "تمرين": "activity",
    "تمارين": "activity",
    "عادات": "habits",
    "عاده": "habits",
    "روتين": "habits",
}
_AR_GENERIC = frozenset("النفسيه نفسيه الصحه صحه".split())
_AR_FOLLOW_UPS: dict[str, frozenset[str]] = {
    "in-arabic": frozenset("عاميه بالعاميه المصريه مصري بالمصري عربي بالعربي ترجم ترجمه".split()),
    "continue": frozenset("كمل نكمل اكتر اكثر تفاصيل وضح وضحلي زياده".split()),
    "summary": frozenset("ملخص لخص لخصلي باختصار اختصار".split()),
}
_AR_PREFIXES = ("وبال", "وال", "بال", "لل", "فال", "كال", "ال", "و", "ب", "ل", "ف")
_AR_SUFFIXES = ("هالي", "لي", "ني", "ها", "هم", "ه", "ك")
_LATIN_IN_ARABIC = frozenset({"mindfulness"})  # written in Latin inside Arabic questions

_ARABIC_CHAR = re.compile("[؀-ۿ]")
_ARABIC_WORD = re.compile("[ء-يٱ-ۓ]+")
_TATWEEL = "ـ"
_LATIN_WORD = re.compile(r"[a-z]+")
_DIGIT = re.compile("[0-9٠-٩۰-۹]")
_RIGHT_QUOTE = "’"


@dataclass(frozen=True)
class GateResult:
    outcome: GateOutcome
    prompt: DemoPrompt | None = None
    language: Language = "en"

    @property
    def canonical(self) -> str:
        """The reviewed question used downstream instead of the user's own words."""
        if self.prompt is None:
            raise ValueError("only accepted messages have a canonical question")
        return self.prompt.ar if self.language == "ar" else self.prompt.en


def _crisis(text: str) -> bool:
    lowered = text.casefold()
    folded = normalize_arabic(lowered)
    return any(term in lowered or normalize_arabic(term) in folded for term in CRISIS_SCREEN)


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


def _classify_words(
    words: list[str],
    neutral: frozenset[str],
    topics: dict[str, frozenset[str]],
    weak: dict[str, str],
    generic: frozenset[str],
    follow_ups: dict[str, frozenset[str]],
    forms: Callable[[str], list[str]] | None,
) -> tuple[bool, list[set[str]], set[str]]:
    """(all words known, [strong, weak, generic] topics, follow-up intents)."""
    strong: set[str] = set()
    weak_hits: set[str] = set()
    generic_hits: set[str] = set()
    follow: set[str] = set()
    for word in words:
        candidates = forms(word) if forms is not None else [word]
        known = False
        for form in candidates:
            for topic, vocabulary in topics.items():
                if form in vocabulary:
                    strong.add(topic)
                    known = True
            for intent, vocabulary in follow_ups.items():
                if form in vocabulary:
                    follow.add(intent)
                    known = True
            if form in weak:
                weak_hits.add(weak[form])
                known = True
            if form in generic:
                generic_hits.add("habits")
                known = True
            if form in neutral:
                known = True
        if not known:
            return False, [], set()
    return True, [strong, weak_hits, generic_hits], follow


def classify(message: str, earlier_intents: list[str]) -> GateResult:
    """Decide whether a typed message is a supported educational question.

    ``earlier_intents`` are the prompt ids of earlier recognised questions in the same
    conversation (a follow-up needs one). Fail-closed: anything not positively
    recognised is refused.
    """
    text = " ".join(message.split())
    if len(text) > MAX_TYPED_CHARS:
        return GateResult("too_long")
    is_arabic = bool(_ARABIC_CHAR.search(text))
    language: Language = "ar" if is_arabic else "en"
    if _crisis(text):
        return GateResult("crisis", language=language)

    # The reviewed questions themselves (the suggestions), in either language.
    for prompt in DEMO_PROMPTS:
        for candidate, lang in ((prompt.en, "en"), (prompt.ar, "ar")):
            if normalize(candidate) == normalize(text):
                if prompt.follow_up and not earlier_intents:
                    return GateResult("needs_context", language=language)
                return GateResult("accept", prompt, "ar" if lang == "ar" else "en")

    if _DIGIT.search(text):  # ages, dates, phone numbers, doses: never interpreted
        return GateResult("unsupported", language=language)

    lowered = text.casefold().replace(_RIGHT_QUOTE, "'").replace("-", " ")
    latin = _LATIN_WORD.findall(lowered)
    if is_arabic:
        arabic = [normalize_arabic(w.replace(_TATWEEL, "")) for w in _ARABIC_WORD.findall(lowered)]
        if any(w not in _LATIN_IN_ARABIC for w in latin):
            return GateResult("unsupported", language=language)
        if not arabic or len(arabic) + len(latin) > MAX_WORDS:
            return GateResult("unsupported", language=language)
        ok, tiers, follow = _classify_words(
            arabic, _AR_NEUTRAL, _AR_TOPICS, _AR_WEAK, _AR_GENERIC, _AR_FOLLOW_UPS, _arabic_forms
        )
        if ok and latin:
            tiers[0].add("mindfulness")
    else:
        if not latin or len(latin) > MAX_WORDS:
            return GateResult("unsupported", language=language)
        ok, tiers, follow = _classify_words(
            latin, _EN_NEUTRAL, _EN_TOPICS, _EN_WEAK, _EN_GENERIC, _EN_FOLLOW_UPS, None
        )
    if not ok:
        return GateResult("unsupported", language=language)

    topics = next((tier for tier in tiers if tier), set())
    if "in-arabic" in follow and not is_arabic:
        language = "ar"
    if len(topics) > 1:
        return GateResult("multiple_topics", language=language)
    if len(topics) == 1:
        return GateResult("accept", _BY_ID[topics.pop()], language)
    if len(follow) == 1:
        if not earlier_intents:
            return GateResult("needs_context", language=language)
        intent = follow.pop()
        # "Explain that in Egyptian Arabic" answers in Arabic; the others keep the
        # language the user wrote in.
        return GateResult("accept", _BY_ID[intent], "ar" if intent == "in-arabic" else language)
    return GateResult("unsupported", language=language)


SUPPORTED_TOPICS: tuple[str, ...] = tuple(p.prompt_id for p in DEMO_PROMPTS if not p.follow_up)
