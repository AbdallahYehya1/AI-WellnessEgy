"""Restricted educational demo (OPEN_DECISIONS D-48): predetermined questions only.

The prototype's safety assessor is NOT clinically validated, so deployed chat accepts
only these approved, low-risk educational questions, from allow-listed adult test
accounts. Free text is refused before safety assessment, retrieval or any provider
call: nothing a user types beyond these questions reaches a model. Earlier user turns
come from the browser unsigned, so they must be approved questions too.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.auth.principal import AuthenticatedPrincipal

DEMO_NOTICE = (
    "This demonstration answers only the listed example questions. "
    "It is not a place to describe personal problems."
)


@dataclass(frozen=True)
class DemoPrompt:
    prompt_id: str
    en: str
    ar: str
    follow_up: bool = False  # only after an earlier approved question


DEMO_PROMPTS: tuple[DemoPrompt, ...] = (
    DemoPrompt(
        "stress",
        "I've been stressed about work. What general coping techniques might help?",
        "حاسس بتوتر من الشغل، أعمل إيه؟",
    ),
    DemoPrompt(
        "grounding",
        "Can you explain a simple grounding exercise?",
        "ممكن تشرحلي تمرين الارتكاز؟",
    ),
    DemoPrompt(
        "habits",
        "What are some everyday habits that support wellbeing?",
        "إيه العادات اليومية اللي بتساعد على العافية؟",
    ),
    DemoPrompt(
        "thoughts",
        "How can I handle difficult thoughts and feelings?",
        "إزاي أتعامل مع الأفكار والمشاعر الصعبة؟",
    ),
    DemoPrompt(
        "sleep",
        "What habits help with better sleep?",
        "إيه العادات اللي تساعد على نوم أحسن؟",
    ),
    DemoPrompt(
        "activity",
        "How does physical activity help mental wellbeing?",
        "إزاي النشاط البدني بيساعد الصحة النفسية؟",
    ),
    DemoPrompt(
        "mindfulness",
        "What is mindfulness?",
        "يعني إيه اليقظة الذهنية (mindfulness)؟",
    ),
    DemoPrompt(
        "in-arabic",
        "Can you explain that in Egyptian Arabic?",
        "ممكن تشرحها بالعامية المصرية؟",
        follow_up=True,
    ),
    DemoPrompt(
        "continue",
        "Can we continue discussing the earlier technique?",
        "ممكن نكمل في نفس الموضوع؟",
        follow_up=True,
    ),
    DemoPrompt(
        "summary",
        "Can you give me a short summary?",
        "ممكن ملخص قصير؟",
        follow_up=True,
    ),
)

_TRAILING = re.compile(r"[\s?.!؟،,]+$")


def normalize(text: str) -> str:
    return _TRAILING.sub("", " ".join(text.split()).casefold())


_APPROVED: dict[str, DemoPrompt] = {
    normalize(text): prompt for prompt in DEMO_PROMPTS for text in (prompt.en, prompt.ar)
}


def match_prompt(message: str, earlier_user_turns: list[str]) -> DemoPrompt | None:
    """The approved prompt this message is, or None if the request must be refused."""
    prompt = _APPROVED.get(normalize(message))
    if prompt is None or (prompt.follow_up and not earlier_user_turns):
        return None
    if any(normalize(turn) not in _APPROVED for turn in earlier_user_turns):
        return None
    return prompt


def parse_allowlist(raw: str) -> frozenset[str]:
    """Comma-separated emails and/or Supabase user ids, compared case-insensitively."""
    return frozenset(item.strip().casefold() for item in raw.split(",") if item.strip())


def is_allowed(
    principal: AuthenticatedPrincipal, allowlist: frozenset[str], *, everyone: bool = False
) -> bool:
    """Allow-list check. ``everyone`` is the explicit all-consented-adults mode: the
    caller has already passed authentication, the consent gate and the adult band."""
    if everyone:
        return True
    candidates = {str(principal.user_id).casefold()}
    if principal.email:
        candidates.add(principal.email.casefold())
    return bool(candidates & allowlist)
