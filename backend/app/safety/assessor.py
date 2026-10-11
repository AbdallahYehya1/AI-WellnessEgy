"""Safety assessment, wrapped so every failure is fail-closed.

`assess_safety_risk` never lets an assessor error, timeout or malformed
result become LOW: all of them become UNKNOWN with an `assessor_*` reason,
which the policy maps to "unavailable" (no generation).

`SyntheticTestAssessor` is TEST-ONLY. It reacts to explicit synthetic markers
so tests and local development can exercise each path. It contains no
clinical detection logic and must never be used with real users.
"""

from __future__ import annotations

import concurrent.futures
from typing import ClassVar, Protocol

from app.safety.contracts import Assessment, RiskLevel, SafetyDecision
from app.safety.policy import SafetyPolicy

ASSESSMENT_TIMEOUT_SECONDS = 2.0

_EXECUTOR = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="safety")


class SafetyAssessor(Protocol):
    def assess(self, window: list[str], age_band: str) -> Assessment: ...


def assess_safety_risk(
    assessor: SafetyAssessor,
    policy: SafetyPolicy,
    window: list[str],
    age_band: str,
    timeout: float = ASSESSMENT_TIMEOUT_SECONDS,
) -> SafetyDecision:
    """Assess the whole conversation window (not just the last message)."""
    future = _EXECUTOR.submit(assessor.assess, list(window), age_band)
    try:
        result = _checked(future.result(timeout=timeout))
    except concurrent.futures.TimeoutError:
        future.cancel()
        result = Assessment(RiskLevel.UNKNOWN, reason_code="assessor_timeout")
    except Exception:  # any assessor failure must block generation
        result = Assessment(RiskLevel.UNKNOWN, reason_code="assessor_error")
    return policy.decide(result)


def _checked(result: object) -> Assessment:
    """Treat the assessor's return value as untrusted."""
    if not isinstance(result, Assessment) or not isinstance(result.risk_level, RiskLevel):
        return Assessment(RiskLevel.UNKNOWN, reason_code="assessor_malformed")
    return result


class SyntheticTestAssessor:
    """TEST-ONLY assessor driven by explicit markers. Not clinical."""

    MARKERS: ClassVar[dict[str, RiskLevel]] = {
        "[[synthetic-high]]": RiskLevel.HIGH,
        "[[synthetic-medium]]": RiskLevel.MEDIUM,
        "[[synthetic-unknown]]": RiskLevel.UNKNOWN,
    }
    # Engineering placeholder for scope checks (diagnosis / medication
    # requests), not a clinical rule set.
    OUT_OF_SCOPE_MARKERS = (
        "diagnose me",
        "do i have depression",
        "what medication",
        "which medication",
        "شخّصني",
        "شخصني",
        "عندي اكتئاب",
        "دواء ايه",
        "دوا ايه",
    )

    def assess(self, window: list[str], age_band: str) -> Assessment:
        text = "\n".join(window).lower()
        if "[[synthetic-error]]" in text:
            raise RuntimeError("synthetic assessor failure")
        if "[[synthetic-timeout]]" in text:
            import time

            time.sleep(ASSESSMENT_TIMEOUT_SECONDS + 1)
        if "[[synthetic-malformed]]" in text:
            return "not an assessment"  # type: ignore[return-value]  # deliberately malformed
        for marker, level in self.MARKERS.items():
            if marker in text:
                return Assessment(level, reason_code=f"synthetic_{level.value}")
        if any(m in text for m in self.OUT_OF_SCOPE_MARKERS):
            return Assessment(RiskLevel.LOW, out_of_scope=True, reason_code="synthetic_scope")
        return Assessment(RiskLevel.LOW, reason_code="synthetic_low")
