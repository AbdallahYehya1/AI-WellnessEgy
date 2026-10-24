"""Output validation before anything reaches the user.

Checks the structure, that every citation points to a passage retrieved for
this request, and a small set of engineering heuristics for prohibited
content (diagnosis, medication advice, claiming to be a clinician). The
heuristics are NOT a clinical review and will miss things; they are a last
line of defence, not a guarantee.
"""

from __future__ import annotations

import re

from app.ai.provider.base import GenerationResult

_PROHIBITED = re.compile(
    r"\byou (have|are suffering from) (depression|anxiety|bipolar|adhd|ptsd|ocd|a disorder)\b"
    r"|\b(take|start|stop|increase|decrease|change) (your |the )?"
    r"(medication|medicine|meds|pills|antidepressants|dose)\b"
    r"|\bi am (a|your) (doctor|therapist|psychiatrist|psychologist|clinician)\b"
    r"|عندك اكتئاب|خد (ال)?دوا|وقف (ال)?دوا|انا دكتور|أنا طبيب",
    re.IGNORECASE,
)


def validate_output(
    result: object, retrieved_ids: set[str], max_chars: int, *, allow_uncited: bool = False
) -> bool:
    """``allow_uncited``: assistant coaching (D-59) may answer without citations; it is
    then labelled as general guidance. Any citation must still be of a retrieved passage."""
    if not isinstance(result, GenerationResult):
        return False
    if not result.text.strip() or len(result.text) > max_chars:
        return False
    cited = set(result.cited_chunk_ids)
    if (not cited and not allow_uncited) or not cited <= retrieved_ids:
        return False  # uncited, or cites something that was not retrieved
    return not _PROHIBITED.search(result.text)
