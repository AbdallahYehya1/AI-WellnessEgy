"""Age-band experiences.

Bands use DRAFT boundaries (under 13 / 13-17 / 18+) that are not legally or
clinically approved. Only the adult band can be enabled: `ENABLEABLE_BANDS`
is a hard-coded allowlist, so child and teen experiences cannot be switched
on through configuration (OPEN_DECISIONS D-12; the product is adults-only).
Age is never inferred from how someone writes.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class AgeBand(StrEnum):
    CHILD = "child"  # draft: under 13
    TEEN = "teen"  # draft: 13-17
    ADULT = "adult"  # draft: 18+


@dataclass(frozen=True)
class AgeBandConfig:
    band: AgeBand
    label: str
    # Tone instructions for the provider. Engineering placeholders, not
    # reviewed clinical or developmental guidance.
    instructions: str
    max_reply_chars: int


AGE_BANDS: dict[AgeBand, AgeBandConfig] = {
    AgeBand.CHILD: AgeBandConfig(
        AgeBand.CHILD,
        "Child (pending legal and clinical review)",
        "PENDING REVIEW: child-appropriate instructions have not been written.",
        600,
    ),
    AgeBand.TEEN: AgeBandConfig(
        AgeBand.TEEN,
        "Teen (pending legal and clinical review)",
        "PENDING REVIEW: teen-appropriate instructions have not been written.",
        800,
    ),
    AgeBand.ADULT: AgeBandConfig(
        AgeBand.ADULT,
        "Adult",
        "Be warm and concise. Offer general wellness information only, grounded in the "
        "provided passages. Do not diagnose, prescribe or claim to be a clinician.",
        1200,
    ),
}

# Only these bands may ever be enabled. Changing this requires legal and
# clinical approval (D-12), not a config flag.
ENABLEABLE_BANDS: frozenset[AgeBand] = frozenset({AgeBand.ADULT})


def resolve_age_band() -> AgeBand:
    """Every account is adult: sign-up requires an 18+ attestation (D-12)."""
    return AgeBand.ADULT


def band_enabled(band: AgeBand) -> bool:
    return band in ENABLEABLE_BANDS
