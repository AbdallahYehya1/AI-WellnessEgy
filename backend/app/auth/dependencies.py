"""FastAPI dependencies for authenticated endpoints.

Use ``CurrentPrincipal`` as a route parameter to require a verified
Supabase session. Failures return a uniform ``401`` (or ``503`` when tokens
cannot be verified at all), never a partially authenticated request.
"""

from __future__ import annotations

import re
from typing import Annotated

from fastapi import Depends, Request

from app.auth.principal import AuthenticatedPrincipal
from app.auth.tokens import AuthUnavailableError, SupabaseTokenVerifier, TokenRejectedError
from app.common.errors import ApiError
from app.core.logging import get_logger

logger = get_logger(__name__)

MAX_TOKEN_LENGTH = 8192
_BEARER = re.compile(r"^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$", re.IGNORECASE)
_WWW_AUTHENTICATE = {"WWW-Authenticate": 'Bearer realm="api"'}


def _unauthorized(message: str) -> ApiError:
    return ApiError(401, "unauthorized", message, headers=_WWW_AUTHENTICATE)


def get_token_verifier(request: Request) -> SupabaseTokenVerifier:
    # Created once per app in create_app(), so the JWKS cache is shared.
    verifier: SupabaseTokenVerifier = request.app.state.token_verifier
    return verifier


def extract_bearer_token(request: Request) -> str:
    header = request.headers.get("Authorization")
    if not header:
        logger.info("auth_rejected", extra={"reason": "missing_token"})
        raise _unauthorized("Authentication is required.")
    match = _BEARER.match(header.strip()) if len(header) <= MAX_TOKEN_LENGTH else None
    if match is None:
        logger.info("auth_rejected", extra={"reason": "malformed_header"})
        raise _unauthorized("The access token is invalid or has expired.")
    return match.group(1)


def get_current_principal(
    token: Annotated[str, Depends(extract_bearer_token)],
    verifier: Annotated[SupabaseTokenVerifier, Depends(get_token_verifier)],
) -> AuthenticatedPrincipal:
    try:
        return verifier.verify(token)
    except TokenRejectedError as exc:
        logger.info("auth_rejected", extra={"reason": exc.reason})
        raise _unauthorized("The access token is invalid or has expired.") from None
    except AuthUnavailableError as exc:
        logger.error("auth_unavailable", extra={"reason": exc.reason})
        raise ApiError(
            503,
            "auth_unavailable",
            "Sign-in is temporarily unavailable. Please try again shortly.",
        ) from None


CurrentPrincipal = Annotated[AuthenticatedPrincipal, Depends(get_current_principal)]
