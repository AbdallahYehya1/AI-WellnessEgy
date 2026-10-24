"""Deterministic fake provider for development and tests. No network calls.

Synthetic markers in the message trigger failure modes so tests can prove
the pipeline handles them: `[[fake-timeout]]`, `[[fake-error]]`,
`[[fake-bad-citation]]`, `[[fake-malformed]]`, `[[fake-diagnose]]`.
"""

from __future__ import annotations

import re

from app.ai.provider.base import GenerationRequest, GenerationResult, ProviderError
from app.safety.gate import GenerationPermit

_HEADING = re.compile(r"^[^.]{0,160}\)\.\s+")  # "Grounding (WHO, ...). " source headings
_ARABIC = re.compile("[؀-ۿ]")
LEAD_IN = {
    "en": "Thanks for sharing that. Here is some general wellness information that may help:",
    "ar": "شكرًا إنك شاركت ده. دي معلومات عامة عن العافية ممكن تفيدك:",
}


def _excerpt(text: str, limit: int = 260) -> str:
    """The passage's own opening sentences (its heading removed), cut at a sentence end."""
    body = _HEADING.sub("", text, count=1).strip()
    if len(body) <= limit:
        return body
    cut = body[:limit]
    end = max(cut.rfind(". "), cut.rfind("؟ "), cut.rfind("? "), cut.rfind("، "))
    return (cut[: end + 1] if end > 80 else cut).rstrip() + " …"


class FakeProvider:
    """Scripted: quotes retrieved passages. It does not understand or translate anything."""

    kind = "scripted"
    model_name: str | None = None

    def __init__(self) -> None:
        self.calls: list[GenerationRequest] = []

    def generate(self, permit: GenerationPermit, request: GenerationRequest) -> GenerationResult:
        self.calls.append(request)
        text = request.message.lower()
        if "[[fake-timeout]]" in text or "[[fake-error]]" in text:
            raise ProviderError("fake provider failure")
        if "[[fake-malformed]]" in text:
            return GenerationResult(text="", cited_chunk_ids=[])
        if "[[fake-bad-citation]]" in text:
            return GenerationResult(
                text="Here is some general information.", cited_chunk_ids=["not-retrieved"]
            )
        if "[[fake-diagnose]]" in text:
            return GenerationResult(
                text="You have depression and should take medication.",
                cited_chunk_ids=[request.passages[0].chunk_id],
            )
        if "[[fake-risk]]" in text:
            return GenerationResult(
                text="Please reach out for help.", cited_chunk_ids=[], risk="self_harm"
            )
        if not request.passages:  # assistant coaching with no matching evidence
            return GenerationResult(
                text="Here are some general, practical ideas to consider. (Scripted test reply.)",
                cited_chunk_ids=[],
            )
        cited = request.passages[:2]
        language = "ar" if _ARABIC.search(cited[0].text) else "en"
        reply = LEAD_IN[language] + " " + " ".join(_excerpt(p.text) for p in cited)
        return GenerationResult(
            text=reply[: request.max_chars], cited_chunk_ids=[p.chunk_id for p in cited]
        )
