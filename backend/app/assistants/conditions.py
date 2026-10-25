"""Activity guidance for health conditions, built locally (D-63).

When a Fitness question mentions pregnancy, type-2 diabetes or high blood pressure, the
answer is WHO's own guidance for that group, quoted verbatim from the knowledge base with
its citation. Nothing is sent to the provider: the condition is health data, and in
structured mode the model could not take it into account anyway. Danger signs in
pregnancy, injuries, pain and other conditions never reach this module (understand()
routes them to urgent care or to a clinician).
"""

from __future__ import annotations

from typing import Literal

Condition = Literal["pregnancy", "chronic"]
# Under the 2,000-character limit for browser-held history turns.
LOCAL_REPLY_CHARS = 1950

_SLUG = {"en": "who-physical-activity-guidelines-en", "ar": "who-physical-activity-guidelines-ar"}

# (condition, language, later turn) -> section headings, in order.
SECTIONS: dict[tuple[Condition, str, bool], tuple[str, ...]] = {
    ("pregnancy", "en", False): (
        "Recommendations for pregnant and postpartum women (WHO)",
        "Safety considerations for pregnant women (WHO)",
    ),
    ("pregnancy", "en", True): (
        "When to stop and seek advice in pregnancy (WHO)",
        "Good practice for pregnant and postpartum women (WHO)",
    ),
    ("chronic", "en", False): ("Recommendations for adults with chronic conditions (WHO)",),
    ("chronic", "en", True): ("Good practice for adults with chronic conditions (WHO)",),
    ("pregnancy", "ar", False): (
        "توصيات للنساء في فترة الحمل وبعد الولادة (منظمة الصحة العالمية)",
        "اعتبارات السلامة للحوامل (منظمة الصحة العالمية)",
    ),
    ("pregnancy", "ar", True): (
        "متى تتوقف الحامل وتطلب المشورة (منظمة الصحة العالمية)",
        "ملاحظات بشأن الممارسة الجيدة للنساء في فترة الحمل وبعد الولادة (منظمة الصحة العالمية)",
    ),
    ("chronic", "ar", False): (
        "توصيات للبالغين الذين يعانون من حالات مرضية مزمنة (منظمة الصحة العالمية)",
    ),
    ("chronic", "ar", True): (
        "ملاحظات بشأن الممارسة الجيدة للبالغين الذين يعانون من حالات مرضية مزمنة (منظمة الصحة العالمية)",  # noqa: E501
    ),
}

_INTRO: dict[tuple[Condition, str, bool], str] = {
    ("pregnancy", "en", False): (
        "Here is what the World Health Organization recommends about physical activity during "
        "and after pregnancy, in its own words:"
    ),
    ("chronic", "en", False): (
        "Here is what the World Health Organization recommends about physical activity for "
        "adults living with type-2 diabetes or high blood pressure, in its own words:"
    ),
    ("pregnancy", "en", True): "More from the World Health Organization's guidance for pregnancy:",
    ("chronic", "en", True): "More from the World Health Organization's guidance:",
    (
        "pregnancy",
        "ar",
        False,
    ): "دي توصيات منظمة الصحة العالمية عن النشاط البدني أثناء الحمل وبعد الولادة، بنصّها:",
    ("chronic", "ar", False): (
        "دي توصيات منظمة الصحة العالمية عن النشاط البدني للبالغين اللي عندهم السكري من النوع "
        "التاني أو ضغط الدم العالي، بنصّها:"
    ),
    ("pregnancy", "ar", True): "ودي باقي إرشادات منظمة الصحة العالمية للحمل:",
    ("chronic", "ar", True): "ودي باقي إرشادات منظمة الصحة العالمية:",
}

# Worded so they also fit someone asking for a partner or relative ("my wife is
# pregnant"); the Arabic avoids gendered imperatives.
NOTES: dict[tuple[Condition, str], str] = {
    ("pregnancy", "en"): (
        "It is important to talk to a doctor or midwife before starting or changing activity, "
        "and to ask which warning signs mean stopping and getting help straight away. With "
        "bleeding, fluid leaking, painful contractions, dizziness or chest pain, stop and get "
        "medical help now."
    ),
    ("chronic", "en"): (
        "The doctor who knows the condition and the medicines is the right person to ask about "
        "the type and amount of activity that suits, especially before anything more intense "
        "than brisk walking."
    ),
    ("pregnancy", "ar"): (
        "مهم جدًا الكلام مع الدكتور قبل البدء في أي نشاط أو تغييره، والسؤال عن علامات الخطر اللي "
        "تستدعي التوقف وطلب المساعدة فورًا. ولو حصل نزيف أو نزول مية أو انقباضات مؤلمة أو دوخة "
        "أو ألم في الصدر، لازم التوقف فورًا وطلب مساعدة طبية."
    ),
    ("chronic", "ar"): (
        "الدكتور المتابع للحالة والأدوية هو أنسب حد يتسأل عن نوع النشاط ومقداره المناسب، خصوصًا "
        "قبل أي مجهود أشد من المشي السريع."
    ),
}


def slug(language: str) -> str:
    return _SLUG["ar" if language == "ar" else "en"]


def sections(condition: Condition, language: str, later: bool) -> tuple[str, ...]:
    return SECTIONS[(condition, "ar" if language == "ar" else "en", later)]


def compose_reply(
    condition: Condition, language: str, later: bool, passages: list[tuple[str, str]]
) -> str:
    """``passages``: (heading, content) in order. The content is quoted as stored."""
    lang = "ar" if language == "ar" else "en"
    parts = [_INTRO[(condition, lang, later)]]
    for heading, content in passages:
        body = (
            content[len(heading) :].lstrip(". ").strip() if content.startswith(heading) else content
        )
        parts.append(f"**{heading}**\n{body}")
    parts.append(NOTES[(condition, lang)])
    return "\n\n".join(parts)
