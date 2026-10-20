"""Provider-agnostic generation interface.

Every provider method takes a `GenerationPermit`; providers are only ever
called through `safety.gate.generate_with_permit`, which consumes the permit
first. No real provider exists yet: user messages are not sent to any
external service until D-9/D-36 are decided.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.safety.gate import GenerationPermit

PROVIDER_TIMEOUT_SECONDS = 10.0


@dataclass(frozen=True)
class Passage:
    chunk_id: str
    text: str


@dataclass(frozen=True)
class GenerationRequest:
    message: str
    history: list[tuple[str, str]]  # (role, text), already validated
    passages: list[Passage]  # approved, age-applicable evidence only
    instructions: str
    max_chars: int
    # "en" or "ar": the language the reply must be written in, decided by the server
    # (the model is not left to guess it from a re-expressed question).
    reply_language: str | None = None


@dataclass(frozen=True)
class GenerationResult:
    text: str
    cited_chunk_ids: list[str]


class ProviderError(Exception):
    """Normalised provider failure (timeout, outage, bad response)."""


class ChatProvider(Protocol):
    def generate(
        self, permit: GenerationPermit, request: GenerationRequest
    ) -> GenerationResult: ...
