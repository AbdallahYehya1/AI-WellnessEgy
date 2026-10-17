"""Deterministic fake provider for development and tests. No network calls.

Synthetic markers in the message trigger failure modes so tests can prove
the pipeline handles them: `[[fake-timeout]]`, `[[fake-error]]`,
`[[fake-bad-citation]]`, `[[fake-malformed]]`, `[[fake-diagnose]]`.
"""

from __future__ import annotations

from app.ai.provider.base import GenerationRequest, GenerationResult, ProviderError
from app.safety.gate import GenerationPermit


class FakeProvider:
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
        cited = request.passages[:2]
        summary = " ".join(p.text.split(". ")[0].rstrip(".") + "." for p in cited)
        reply = (
            "Thanks for sharing that. Here is some general wellness information that may "
            f"help: {summary}"
        )
        return GenerationResult(
            text=reply[: request.max_chars], cited_chunk_ids=[p.chunk_id for p in cited]
        )
