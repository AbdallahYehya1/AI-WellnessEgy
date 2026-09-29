"""Supabase access-token verification.

Projects on asymmetric signing keys (ES256/RS256) are verified against the
project's public JWKS. Projects still on the legacy shared secret (HS256) are
verified only when ``SUPABASE_JWT_SECRET`` is configured. The algorithm list
passed to PyJWT is always a single, server-chosen value, so a token cannot
pick a weaker algorithm (``none``) or trick us into using a public key as an
HMAC secret.

Checked on every token: signature, ``exp`` (and ``nbf`` if present), issuer,
audience, a UUID ``sub``, ``role == "authenticated"``, and that the session
is not anonymous.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol
from uuid import UUID

import jwt
from jwt import PyJWK, PyJWKClient

from app.auth.principal import AuthenticatedPrincipal
from app.core.config import Settings

ASYMMETRIC_ALGORITHMS = frozenset({"ES256", "RS256"})
LEGACY_ALGORITHM = "HS256"
REQUIRED_CLAIMS = ["exp", "iat", "sub", "aud", "iss", "role"]
CLOCK_SKEW_SECONDS = 30

RejectionReason = Literal[
    "malformed",
    "unsupported_algorithm",
    "unknown_key",
    "invalid_signature",
    "expired",
    "not_yet_valid",
    "invalid_issuer",
    "invalid_audience",
    "missing_claim",
    "invalid_subject",
    "invalid_role",
    "anonymous_session",
    "invalid",
]


class TokenRejectedError(Exception):
    """The token is not acceptable. ``reason`` is safe to log; the token is not."""

    def __init__(self, reason: RejectionReason) -> None:
        super().__init__(reason)
        self.reason: RejectionReason = reason


class AuthUnavailableError(Exception):
    """Tokens cannot be verified right now (not configured, or JWKS unreachable)."""

    def __init__(self, reason: Literal["not_configured", "jwks_unavailable"]) -> None:
        super().__init__(reason)
        self.reason = reason


class SigningKeySource(Protocol):
    def get_signing_key_from_jwt(self, token: str) -> PyJWK: ...


class SupabaseTokenVerifier:
    def __init__(self, settings: Settings, key_source: SigningKeySource | None = None) -> None:
        self._issuer = settings.supabase_issuer
        self._audience = settings.supabase_jwt_audience
        self._legacy_secret = settings.supabase_jwt_secret
        jwks_url = settings.supabase_jwks_url
        if key_source is None and jwks_url is not None:
            key_source = PyJWKClient(
                jwks_url,
                lifespan=settings.supabase_jwks_cache_seconds,
                timeout=settings.supabase_jwks_timeout_seconds,
            )
        self._key_source = key_source

    def verify(self, token: str) -> AuthenticatedPrincipal:
        if self._issuer is None:
            raise AuthUnavailableError("not_configured")

        algorithm, key = self._select_key(token)
        try:
            claims: dict[str, Any] = jwt.decode(
                token,
                key,
                algorithms=[algorithm],
                audience=self._audience,
                issuer=self._issuer,
                leeway=CLOCK_SKEW_SECONDS,
                options={"require": REQUIRED_CLAIMS},
            )
        except jwt.ExpiredSignatureError as exc:
            raise TokenRejectedError("expired") from exc
        except jwt.ImmatureSignatureError as exc:
            raise TokenRejectedError("not_yet_valid") from exc
        except jwt.InvalidAudienceError as exc:
            raise TokenRejectedError("invalid_audience") from exc
        except jwt.InvalidIssuerError as exc:
            raise TokenRejectedError("invalid_issuer") from exc
        except jwt.InvalidSignatureError as exc:
            raise TokenRejectedError("invalid_signature") from exc
        except jwt.MissingRequiredClaimError as exc:
            raise TokenRejectedError("missing_claim") from exc
        except jwt.DecodeError as exc:
            raise TokenRejectedError("malformed") from exc
        except jwt.PyJWTError as exc:  # includes InvalidTokenError and key errors
            raise TokenRejectedError("invalid") from exc

        return _principal_from_claims(claims)

    def _select_key(self, token: str) -> tuple[str, Any]:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.DecodeError as exc:
            raise TokenRejectedError("malformed") from exc

        algorithm = header.get("alg")
        if algorithm in ASYMMETRIC_ALGORITHMS and self._key_source is not None:
            try:
                signing_key = self._key_source.get_signing_key_from_jwt(token)
            except jwt.PyJWKClientConnectionError as exc:
                raise AuthUnavailableError("jwks_unavailable") from exc
            except (jwt.PyJWKClientError, jwt.PyJWKSetError) as exc:
                raise TokenRejectedError("unknown_key") from exc
            except jwt.DecodeError as exc:
                raise TokenRejectedError("malformed") from exc
            if signing_key.algorithm_name != algorithm:
                raise TokenRejectedError("unsupported_algorithm")
            return algorithm, signing_key.key

        if algorithm == LEGACY_ALGORITHM and self._legacy_secret is not None:
            return algorithm, self._legacy_secret.get_secret_value()

        raise TokenRejectedError("unsupported_algorithm")


def _principal_from_claims(claims: dict[str, Any]) -> AuthenticatedPrincipal:
    try:
        user_id = UUID(str(claims["sub"]))
    except ValueError as exc:
        raise TokenRejectedError("invalid_subject") from exc
    if claims.get("role") != "authenticated":
        raise TokenRejectedError("invalid_role")
    if claims.get("is_anonymous") is True:
        raise TokenRejectedError("anonymous_session")

    email = claims.get("email")
    aal = claims.get("aal")
    return AuthenticatedPrincipal(
        user_id=user_id,
        email=email if isinstance(email, str) and email else None,
        role="authenticated",
        session_id=_optional_uuid(claims.get("session_id")),
        aal=aal if isinstance(aal, str) else None,
    )


def _optional_uuid(value: object) -> UUID | None:
    try:
        return UUID(str(value)) if value else None
    except ValueError:
        return None
