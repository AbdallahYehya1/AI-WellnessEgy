"""Safety decision types shared by the assessor, the policy and the gate.

The *meaning* of each risk level (thresholds, categories, interventions) is
clinical content that has not been approved (OPEN_DECISIONS D-7). These types
only fix the shape of a decision and its fail-closed defaults.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class RiskLevel(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    UNKNOWN = "unknown"


class Outcome(StrEnum):
    """What the pipeline does with a message."""

    GENERATE = "generate"  # ordinary generation may be authorised
    SUPPORT = "support"  # no generation; approved support template
    OUT_OF_SCOPE = "out_of_scope"  # e.g. diagnosis or medication requests
    UNAVAILABLE = "unavailable"  # safety could not decide; no generation


@dataclass(frozen=True)
class Assessment:
    """Raw output of a safety assessor."""

    risk_level: RiskLevel
    out_of_scope: bool = False
    reason_code: str = "assessed"


@dataclass(frozen=True)
class SafetyDecision:
    risk_level: RiskLevel
    outcome: Outcome
    policy_version: str
    reason_code: str

    @property
    def generation_allowed(self) -> bool:
        return self.outcome is Outcome.GENERATE
