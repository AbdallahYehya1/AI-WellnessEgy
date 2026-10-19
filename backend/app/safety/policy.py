"""Safety policies: map an assessment to an outcome.

Only one policy exists, and it is a TEST-ONLY, SYNTHETIC policy for
development and automated tests. It is not clinical guidance and is refused
in production. A clinically approved policy (D-7) must be added before chat
can run in production.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.safety.contracts import Assessment, Outcome, RiskLevel, SafetyDecision

SYNTHETIC_TEST_POLICY_ID = "synthetic-test-v0"
CURATED_DEMO_POLICY_ID = "curated-educational-demo-v1"


@dataclass(frozen=True)
class SafetyPolicy:
    policy_id: str
    synthetic: bool  # True = test-only, never allowed in production
    # Risk levels for which ordinary generation may be authorised.
    generation_levels: frozenset[RiskLevel]
    # True = may authorise generation ONLY for reviewed, predefined questions
    # (CHAT_DEMO_CURATED); it never assesses free text. Not a clinical policy.
    curated_only: bool = False

    def decide(self, assessment: Assessment) -> SafetyDecision:
        if assessment.risk_level is RiskLevel.HIGH:
            outcome = Outcome.SUPPORT
        elif assessment.risk_level is RiskLevel.UNKNOWN:
            # Unknown never becomes LOW. Assessor failures map here too.
            outcome = (
                Outcome.UNAVAILABLE
                if assessment.reason_code.startswith("assessor_")
                else Outcome.SUPPORT
            )
        elif assessment.out_of_scope:
            outcome = Outcome.OUT_OF_SCOPE
        elif assessment.risk_level in self.generation_levels:
            outcome = Outcome.GENERATE
        else:
            outcome = Outcome.SUPPORT
        return SafetyDecision(
            risk_level=assessment.risk_level,
            outcome=outcome,
            policy_version=self.policy_id,
            reason_code=assessment.reason_code,
        )


# Conservative even for testing: only LOW may generate.
SYNTHETIC_TEST_POLICY = SafetyPolicy(
    policy_id=SYNTHETIC_TEST_POLICY_ID,
    synthetic=True,
    generation_levels=frozenset({RiskLevel.LOW}),
)

# Owner-restricted educational demo (D-48): generation only for the reviewed,
# predefined low-risk questions in app/conversations/demo.py. Allowed in production
# only together with CHAT_DEMO_CURATED and an allow-list (see policy_allowed_in and
# Settings). It is NOT a clinical policy and never decides about free text.
CURATED_DEMO_POLICY = SafetyPolicy(
    policy_id=CURATED_DEMO_POLICY_ID,
    synthetic=False,
    generation_levels=frozenset({RiskLevel.LOW}),
    curated_only=True,
)

# Clinically approved policies go here once D-7 is signed off. Empty on purpose.
APPROVED_POLICIES: dict[str, SafetyPolicy] = {}

_ALL_POLICIES: dict[str, SafetyPolicy] = {
    SYNTHETIC_TEST_POLICY_ID: SYNTHETIC_TEST_POLICY,
    CURATED_DEMO_POLICY_ID: CURATED_DEMO_POLICY,
    **APPROVED_POLICIES,
}


def policy_allowed_in(policy_id: str, environment: str, *, curated: bool = False) -> bool:
    """Whether a policy may run. The curated demo policy needs curated mode
    everywhere; in production only it or a clinically approved policy may run,
    never a synthetic one."""
    policy = _ALL_POLICIES.get(policy_id)
    if policy is None:
        return False
    if policy.curated_only:
        return curated
    if environment == "production":
        return not policy.synthetic and policy_id in APPROVED_POLICIES
    return True


def get_policy(policy_id: str) -> SafetyPolicy:
    return _ALL_POLICIES[policy_id]
