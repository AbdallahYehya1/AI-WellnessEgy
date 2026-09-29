"""Published consent versions.

The consent *text* is legal content that has not been drafted yet
(docs/OPEN_DECISIONS.md, D-11 and D-24). The current version is therefore a
clearly marked placeholder: publishing real text means adding a new
``ConsentDocument`` with a new version and making it current, which requires
every user to accept it again.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

ConsentType = Literal["required", "optional"]


@dataclass(frozen=True)
class ConsentDocument:
    version: str
    consent_type: ConsentType
    published_at: datetime
    summary_url: str
    pending_legal_review: bool


class ConsentCatalog:
    def __init__(self, documents: Sequence[ConsentDocument], current_required_version: str) -> None:
        self._documents = {(doc.version, doc.consent_type): doc for doc in documents}
        current = self._documents.get((current_required_version, "required"))
        if current is None:
            raise ValueError("the current required consent version must be published")
        self.current_required = current

    def is_published(self, version: str) -> bool:
        return any(v == version for v, _ in self._documents)

    def current_for(self, consent_type: ConsentType) -> ConsentDocument | None:
        # Only one required document is current at a time. No optional
        # consents have been defined (D-25).
        return self.current_required if consent_type == "required" else None


PLACEHOLDER_V1 = ConsentDocument(
    version="2026-09-29.draft-1",
    consent_type="required",
    published_at=datetime(2026, 9, 29, tzinfo=UTC),
    summary_url="/onboarding/consent",
    pending_legal_review=True,
)

DEFAULT_CATALOG = ConsentCatalog([PLACEHOLDER_V1], current_required_version=PLACEHOLDER_V1.version)
