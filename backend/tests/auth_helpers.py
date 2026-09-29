"""Test helpers: locally generated signing keys, a fake JWKS, and token minting.

No network access and no real Supabase credentials are involved.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any

import jwt
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from jwt import PyJWK, PyJWKSet
from jwt.algorithms import ECAlgorithm, RSAAlgorithm

from app.auth.tokens import SupabaseTokenVerifier
from app.consent.catalog import ConsentCatalog
from app.core.config import Settings
from app.main import create_app

SUPABASE_URL = "https://test-project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
USER_ID = "7d8f7b0e-3c1a-4b8e-9d2f-5a6c7e8f9a0b"
SESSION_ID = "0b1c2d3e-4f50-4617-8293-a4b5c6d7e8f9"
EMAIL = "person@example.com"
LEGACY_SECRET = "legacy-hs256-secret-for-tests-only-0123456789abcdef"  # noqa: S105 - fake


class SigningKey:
    def __init__(self, algorithm: str, kid: str) -> None:
        self.algorithm = algorithm
        self.kid = kid
        if algorithm == "ES256":
            self.private_key: Any = ec.generate_private_key(ec.SECP256R1())
            public_jwk = json.loads(ECAlgorithm.to_jwk(self.private_key.public_key()))
        else:
            self.private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
            public_jwk = json.loads(RSAAlgorithm.to_jwk(self.private_key.public_key()))
        self.public_jwk: dict[str, Any] = {**public_jwk, "kid": kid, "alg": algorithm, "use": "sig"}


ES256_KEY = SigningKey("ES256", "es-key-1")
RS256_KEY = SigningKey("RS256", "rs-key-1")
# Same kid as ES256_KEY but a different private key: signatures won't verify.
ATTACKER_KEY = SigningKey("ES256", "es-key-1")


def jwks(*keys: SigningKey) -> dict[str, Any]:
    return {"keys": [key.public_jwk for key in keys]}


class FakeKeySource:
    """Resolves signing keys from an in-memory JWKS, like PyJWKClient."""

    def __init__(self, *keys: SigningKey) -> None:
        self._keys = PyJWKSet.from_dict(jwks(*keys))
        self.calls = 0

    def get_signing_key_from_jwt(self, token: str) -> PyJWK:
        self.calls += 1
        kid = jwt.get_unverified_header(token).get("kid")
        for key in self._keys.keys:
            if key.key_id == kid:
                return key
        raise jwt.PyJWKClientError(f"Unable to find a signing key that matches: {kid!r}")


def claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    base: dict[str, Any] = {
        "iss": ISSUER,
        "aud": "authenticated",
        "sub": USER_ID,
        "email": EMAIL,
        "role": "authenticated",
        "aal": "aal1",
        "session_id": SESSION_ID,
        "is_anonymous": False,
        "iat": now,
        "exp": now + 3600,
    }
    base.update(overrides)
    return {k: v for k, v in base.items() if v is not None}


def make_token(
    key: SigningKey = ES256_KEY, headers: dict[str, Any] | None = None, **overrides: Any
) -> str:
    return jwt.encode(
        claims(**overrides),
        key.private_key,
        algorithm=key.algorithm,
        headers={"kid": key.kid, **(headers or {})},
    )


def make_hs256_token(secret: str = LEGACY_SECRET, **overrides: Any) -> str:
    return jwt.encode(claims(**overrides), secret, algorithm="HS256")


def auth_settings(**overrides: Any) -> Settings:
    """Settings for an app with Supabase auth and the test database configured."""
    values: dict[str, Any] = {
        "environment": "test",
        "supabase_url": SUPABASE_URL,
        "database_url": os.environ["TEST_DATABASE_URL"],
    }
    values.update(overrides)
    return Settings(**values)


def fake_verifier(settings: Settings | None = None, *keys: SigningKey) -> SupabaseTokenVerifier:
    return SupabaseTokenVerifier(
        settings or auth_settings(), FakeKeySource(*(keys or (ES256_KEY, RS256_KEY)))
    )


def new_uuid() -> str:
    return str(uuid.uuid4())


USER_B_ID = "2c4e6a80-1b3d-4f5a-8c7e-9d0f1a2b3c4d"
EMAIL_B = "other-person@example.com"


def bearer(sub: str = USER_ID, email: str | None = EMAIL, **overrides: Any) -> dict[str, str]:
    """Authorization header for a valid token belonging to `sub`."""
    return {"Authorization": f"Bearer {make_token(sub=sub, email=email, **overrides)}"}


def api_client(
    settings: Settings | None = None, consent_catalog: ConsentCatalog | None = None
) -> TestClient:
    settings = settings or auth_settings()
    return TestClient(
        create_app(settings, fake_verifier(settings), consent_catalog=consent_catalog)
    )
