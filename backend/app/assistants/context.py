"""What the model provider may receive about a user's situation (D-59).

Three modes, chosen per request (``provider_text``):

- ``structured`` (default, everyone): a question composed from the recognised subtopics
  and allow-listed context labels. The user's sentence never leaves the backend, but the
  specifics of the situation are lost.
- ``minimized`` (only users with current provider-context consent): the user's own
  description with identifiers removed (``redact``), so the situation keeps its meaning:
  who is involved, what clashes, what they want. Removing identifiers does NOT make it
  anonymous; it is still personal and sensitive, which is why it needs consent.
- ``original`` (consent AND a completed privacy/legal review, see config): the user's
  own words.

Redaction is engineering, not a guarantee: it removes e-mail addresses, links, handles,
phone and ID-like numbers, and names introduced in common ways ("my wife Sara",
"my name is ...", "اسمها ..."). It can miss names written without such cues, places and
employers; the consent notice says so.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from app.assistants.registry import Assistant
from app.assistants.understanding import Understanding

ContextMode = Literal["structured", "minimized", "original"]
CONTEXT_CONSENT_VERSION = "chat-context-v1"
MAX_SITUATION_CHARS = 1200  # provider-bound user text per turn, after redaction

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL = re.compile(r"\b(?:https?://|www\.)\S+", re.IGNORECASE)
_HANDLE = re.compile(r"(?<![\w@])@[A-Za-z0-9_.]{2,}")
# Phone and ID-like numbers: 6+ digits, allowing spaces, dots, dashes and a leading +.
# Short numbers (ages, hours, amounts like "3 kids", "10 hours") carry meaning and stay.
_LONG_NUMBER = re.compile(r"(?<![\w])\+?\d[\d\s.\-]{4,}\d(?![\w])")
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")

_RELATIONS_EN = (
    "wife|husband|partner|fiance|fiancee|fiancé|fiancée|boyfriend|girlfriend|son|daughter|"
    "child|kid|brother|sister|mother|father|mom|mum|dad|mother-in-law|father-in-law|"
    "boss|manager|supervisor|colleague|coworker|co-worker|friend|neighbour|neighbor|"
    "teacher|uncle|aunt|cousin|roommate|flatmate"
)
# "my wife Sara" / "my boss, Ahmed," -> "my wife [name]"
_RELATION_NAME = re.compile(
    rf"\b((?i:my|our|his|her|their)\s+(?i:{_RELATIONS_EN}))(,?\s+)([A-Z][a-zà-ÿ'\-]+(?:\s+[A-Z][a-zà-ÿ'\-]+)?)\b"
)
_INTRODUCED_NAME = re.compile(
    r"\b(my name is|i am called|i'm called|named|called|his name is|her name is)\s+"
    r"([A-Z][a-zà-ÿ'\-]+(?:\s+[A-Z][a-zà-ÿ'\-]+)?)",
    re.IGNORECASE,
)
_ARABIC_NAME = re.compile(
    r"(اسمي|اسمه|اسمها|إسمي|إسمه|إسمها|يدعى|تدعى)\s+([^\s،,.!?؟]+(?:\s+[^\s،,.!?؟]+)?)"
)
_ARABIC_STREET = re.compile(r"(شارع|ش\.)\s+[^\s،,.!?؟]+")
_EN_STREET = re.compile(r"\b\d+\s+[A-Z][a-z]+\s+(?:Street|St|Road|Rd|Avenue|Ave)\b\.?")


@dataclass(frozen=True)
class Redaction:
    text: str
    removed: dict[str, int] = field(default_factory=dict)


def redact(message: str) -> Redaction:
    """The message with identifiers replaced by neutral placeholders."""
    removed: dict[str, int] = {}

    def sub(pattern: re.Pattern[str], repl: str, text: str, kind: str) -> str:
        new, n = pattern.subn(repl, text)
        if n:
            removed[kind] = removed.get(kind, 0) + n
        return new

    text = " ".join(message.split())
    text = sub(_EMAIL, "[email]", text, "email")
    text = sub(_URL, "[link]", text, "link")
    text = sub(_HANDLE, "[handle]", text, "handle")
    # Normalise Arabic-Indic digits only for the number check, then substitute in place.
    digits = text.translate(_ARABIC_DIGITS)
    spans = [m.span() for m in _LONG_NUMBER.finditer(digits)]
    for start, end in reversed(spans):
        text = text[:start] + "[number]" + text[end:]
    if spans:
        removed["number"] = len(spans)
    text = sub(_RELATION_NAME, r"\1\2[name]", text, "name")
    text = sub(_INTRODUCED_NAME, r"\1 [name]", text, "name")
    text = sub(_ARABIC_NAME, r"\1 [اسم]", text, "name")
    text = sub(_ARABIC_STREET, r"\1 [مكان]", text, "place")
    text = sub(_EN_STREET, "[place]", text, "place")
    if len(text) > MAX_SITUATION_CHARS:
        text = text[:MAX_SITUATION_CHARS].rsplit(" ", 1)[0] + " …"
    return Redaction(text=text, removed=removed)


def situation_text(message: str, mode: ContextMode) -> str:
    """The user's turn as the provider may see it in this mode (non-structured only)."""
    if mode == "original":
        return " ".join(message.split())[:MAX_SITUATION_CHARS]
    return redact(message).text


def provider_message(
    assistant: Assistant, understanding: Understanding, message: str, mode: ContextMode
) -> str:
    """The latest user turn for the provider.

    Structured: the composed question (no user words). Otherwise: the situation in the
    user's words (redacted unless ``original``) plus the recognised themes, so the model
    answers the actual situation instead of a generic topic.
    """
    if mode == "structured":
        return understanding.question
    themes = "; ".join(
        (s.phrase_ar if understanding.language == "ar" else s.phrase_en)
        for s in understanding.subtopics
    )
    parts = [
        f"Assistant area: {assistant.name_en}.",
        (
            "The person's message: "
            if mode == "original"
            else "The person's message (identifying details removed): "
        )
        + situation_text(message, mode),
    ]
    if themes:
        parts.append(f"Themes recognised: {themes}.")
    return "\n".join(parts)
