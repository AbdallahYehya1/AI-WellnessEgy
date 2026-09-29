"""Consent gate for feature endpoints.

Any future endpoint that handles wellness data must depend on
``ConsentedUser`` so that it is unreachable until the user has explicitly
accepted the *current* required consent version.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.auth.dependencies import CurrentPrincipal
from app.common.errors import ApiError
from app.consent.catalog import ConsentCatalog
from app.consent.service import latest_decision, required_status
from app.core.db import DbSession
from app.users.models import User
from app.users.service import get_or_create_user


def get_consent_catalog(request: Request) -> ConsentCatalog:
    catalog: ConsentCatalog = request.app.state.consent_catalog
    return catalog


ConsentCatalogDep = Annotated[ConsentCatalog, Depends(get_consent_catalog)]


def require_current_consent(
    principal: CurrentPrincipal, session: DbSession, catalog: ConsentCatalogDep
) -> User:
    user = get_or_create_user(session, principal)
    latest = latest_decision(session, user, "required")
    if required_status(catalog.current_required, latest) != "granted":
        raise ApiError(
            403,
            "consent_required",
            "Please review and accept the current terms to continue.",
        )
    return user


ConsentedUser = Annotated[User, Depends(require_current_consent)]
