"""Consent endpoints (docs/API_CONTRACT.md, Consents)."""

from __future__ import annotations

from fastapi import APIRouter, Response

from app.auth.dependencies import CurrentPrincipal
from app.common.errors import ErrorResponse
from app.consent.dependencies import ConsentCatalogDep
from app.consent.schemas import (
    ConsentCreate,
    ConsentRecordResponse,
    ConsentStatusResponse,
    CurrentConsentResponse,
)
from app.consent.service import latest_decision, record_decision, required_status
from app.core.db import DbSession
from app.users.service import get_or_create_user

router = APIRouter(prefix="/consents", tags=["consents"])

ERRORS: dict[int | str, dict[str, object]] = {
    401: {"model": ErrorResponse},
    403: {"model": ErrorResponse},
    422: {"model": ErrorResponse},
    503: {"model": ErrorResponse},
}


@router.get("/current", response_model=CurrentConsentResponse)
def read_current_consent(catalog: ConsentCatalogDep) -> CurrentConsentResponse:
    """The consent version users must currently accept. Public: no user data."""
    doc = catalog.current_required
    return CurrentConsentResponse(
        version=doc.version,
        consent_type=doc.consent_type,
        published_at=doc.published_at,
        summary_url=doc.summary_url,
        pending_legal_review=doc.pending_legal_review,
    )


@router.get("/me", response_model=ConsentStatusResponse, responses=ERRORS)
def read_my_consent(
    principal: CurrentPrincipal, session: DbSession, catalog: ConsentCatalogDep
) -> ConsentStatusResponse:
    """The caller's own status for the current required version."""
    user = get_or_create_user(session, principal)
    latest = latest_decision(session, user, "required")
    return ConsentStatusResponse(
        current_version=catalog.current_required.version,
        status=required_status(catalog.current_required, latest),
        recorded_version=latest.version if latest else None,
        recorded_at=latest.recorded_at if latest else None,
    )


@router.post(
    "",
    response_model=ConsentRecordResponse,
    status_code=201,
    responses={**ERRORS, 200: {"model": ConsentRecordResponse}},
)
def create_consent(
    decision: ConsentCreate,
    principal: CurrentPrincipal,
    session: DbSession,
    catalog: ConsentCatalogDep,
    response: Response,
) -> ConsentRecordResponse:
    """Record an explicit decision. 201 when recorded; 200 when it repeats the
    caller's latest decision for this version (nothing new is stored)."""
    user = get_or_create_user(session, principal, lock=True)
    outcome = record_decision(session, user, catalog, decision)
    if not outcome.created:
        response.status_code = 200
    consent = outcome.consent
    return ConsentRecordResponse(
        consent_id=consent.id,
        version=consent.version,
        granted=consent.granted,
        recorded_at=consent.recorded_at,
    )
