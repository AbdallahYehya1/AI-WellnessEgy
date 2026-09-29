"""Consent service.

Rules:
- Consent is only ever what the user explicitly submitted. Creating an
  account records nothing.
- A decision applies to exactly one version. When a new version becomes
  current, earlier acceptances show as ``outdated`` until the user accepts
  the new version; nothing is upgraded automatically.
- Records are append-only. Re-submitting the same decision is idempotent
  (no new row, no new audit event); changing it adds a new row.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit.service import record_event
from app.common.errors import ApiError
from app.consent.catalog import ConsentCatalog, ConsentDocument, ConsentType
from app.consent.models import Consent
from app.consent.schemas import ConsentCreate, ConsentStatus
from app.users.models import User


def latest_decision(session: Session, user: User, consent_type: ConsentType) -> Consent | None:
    return session.execute(
        select(Consent)
        .where(Consent.user_id == user.id, Consent.consent_type == consent_type)
        .order_by(Consent.recorded_at.desc())
        .limit(1)
    ).scalar_one_or_none()


def required_status(current: ConsentDocument, latest: Consent | None) -> ConsentStatus:
    if latest is None:
        return "missing"
    if latest.version != current.version:
        return "outdated"
    return "granted" if latest.granted else "declined"


@dataclass(frozen=True)
class RecordOutcome:
    consent: Consent
    created: bool


def record_decision(
    session: Session, user: User, catalog: ConsentCatalog, decision: ConsentCreate
) -> RecordOutcome:
    """Record an explicit decision. `user` must be locked by the caller so
    concurrent submissions for the same user are serialised."""
    current = catalog.current_for(decision.consent_type)
    if current is None or current.version != decision.version:
        if catalog.is_published(decision.version):
            raise ApiError(
                422,
                "consent_version_not_current",
                "This consent version has been replaced. Please review the current version.",
            )
        raise ApiError(422, "unknown_version", "This consent version is not recognised.")

    latest = latest_decision(session, user, decision.consent_type)
    if (
        latest is not None
        and latest.version == decision.version
        and latest.granted == decision.granted
        and latest.withdrawn_at is None
    ):
        return RecordOutcome(consent=latest, created=False)

    consent = Consent(
        id=uuid.uuid4(),
        user_id=user.id,
        version=decision.version,
        consent_type=decision.consent_type,
        granted=decision.granted,
    )
    session.add(consent)
    session.flush()
    session.refresh(consent)
    record_event(
        session,
        action="consent.recorded",
        actor_user_id=user.id,
        target_type="consent",
        target_id=consent.id,
        metadata={
            "version": consent.version,
            "consent_type": consent.consent_type,
            "granted": consent.granted,
        },
    )
    return RecordOutcome(consent=consent, created=True)
