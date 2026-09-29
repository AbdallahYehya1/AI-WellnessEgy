"""Supabase JWT verification, the current-principal dependency, and GET /me."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from fastapi.testclient import TestClient
from jwt import PyJWKClient

from app.auth.tokens import SupabaseTokenVerifier
from app.core.config import Settings
from app.main import create_app
from tests.auth_helpers import (
    ATTACKER_KEY,
    EMAIL,
    ES256_KEY,
    ISSUER,
    LEGACY_SECRET,
    RS256_KEY,
    SESSION_ID,
    USER_ID,
    FakeKeySource,
    SigningKey,
    auth_settings,
    claims,
    fake_verifier,
    jwks,
    make_hs256_token,
    make_token,
    new_uuid,
)
from tests.conftest import parse_log_lines

REJECTED_MESSAGE = "The access token is invalid or has expired."


def client_for(
    settings: Settings | None = None, verifier: SupabaseTokenVerifier | None = None
) -> TestClient:
    settings = settings or auth_settings()
    return TestClient(create_app(settings, verifier or fake_verifier(settings)))


def get_me(token: str | None, client: TestClient | None = None, **kwargs: Any) -> Any:
    client = client or client_for()
    headers = dict(kwargs.pop("headers", {}))
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    return client.get("/me", headers=headers, **kwargs)


def assert_unauthorized(response: Any, message: str = REJECTED_MESSAGE) -> None:
    assert response.status_code == 401
    assert response.json() == {"error": {"code": "unauthorized", "message": message}}
    assert response.headers["WWW-Authenticate"] == 'Bearer realm="api"'


# --- Valid tokens -------------------------------------------------------------


@pytest.mark.parametrize("key", [ES256_KEY, RS256_KEY], ids=["ES256", "RS256"])
def test_valid_token_resolves_expected_principal(key: SigningKey) -> None:
    principal = fake_verifier().verify(make_token(key))
    assert str(principal.user_id) == USER_ID
    assert principal.email == EMAIL
    assert principal.role == "authenticated"
    assert str(principal.session_id) == SESSION_ID
    assert principal.aal == "aal1"


def test_me_returns_identity_from_token() -> None:
    response = get_me(make_token())
    assert response.status_code == 200
    assert response.json() == {"user_id": USER_ID, "email": EMAIL}


def test_me_ignores_client_supplied_identity() -> None:
    other = new_uuid()
    response = get_me(
        make_token(),
        params={"user_id": other, "sub": other},
        headers={"X-User-Id": other, "X-Supabase-User": other},
    )
    assert response.status_code == 200
    assert response.json()["user_id"] == USER_ID


def test_me_for_a_different_user_returns_that_users_identity() -> None:
    other = new_uuid()
    response = get_me(make_token(sub=other, email="other@example.com"))
    assert response.json() == {"user_id": other, "email": "other@example.com"}


def test_token_without_email_is_accepted() -> None:
    response = get_me(make_token(email=None))
    assert response.status_code == 200
    assert response.json() == {"user_id": USER_ID, "email": None}


def test_small_clock_skew_is_tolerated() -> None:
    assert get_me(make_token(exp=int(time.time()) - 5)).status_code == 200


def test_bearer_scheme_is_case_insensitive() -> None:
    response = client_for().get("/me", headers={"Authorization": f"bearer {make_token()}"})
    assert response.status_code == 200


def test_legacy_hs256_token_accepted_only_when_secret_configured() -> None:
    settings = auth_settings(supabase_jwt_secret=LEGACY_SECRET)
    response = get_me(make_hs256_token(), client_for(settings))
    assert response.status_code == 200
    assert response.json()["user_id"] == USER_ID


# --- Missing / malformed ------------------------------------------------------


def test_anonymous_request_to_me_is_rejected() -> None:
    assert_unauthorized(get_me(None), "Authentication is required.")


@pytest.mark.parametrize(
    "header",
    [
        "Basic dXNlcjpwYXNz",
        "Bearer",
        "Bearer ",
        "Token abc.def.ghi",
        "Bearer not-a-jwt",
        "Bearer a.b",
        "Bearer a.b.",  # unsigned token shape
        "Bearer a.b.c.d",
        "Bearer abc.def.ghi extra",
    ],
)
def test_malformed_authorization_header_is_rejected(header: str) -> None:
    assert_unauthorized(client_for().get("/me", headers={"Authorization": header}))


def test_jwt_shaped_garbage_is_rejected() -> None:
    assert_unauthorized(get_me("aaaa.bbbb.cccc"))


def test_oversized_header_is_rejected() -> None:
    assert_unauthorized(get_me("a" * 5000 + "." + "b" * 5000 + ".c"))


# --- Expiry -------------------------------------------------------------------


def test_expired_token_is_rejected() -> None:
    now = int(time.time())
    assert_unauthorized(get_me(make_token(iat=now - 7200, exp=now - 3600)))


def test_token_not_yet_valid_is_rejected() -> None:
    now = int(time.time())
    assert_unauthorized(get_me(make_token(nbf=now + 3600)))


# --- Signature ----------------------------------------------------------------


def test_invalid_signature_is_rejected() -> None:
    # Same kid as a trusted key, signed by a different private key.
    assert_unauthorized(get_me(make_token(ATTACKER_KEY)))


def test_tampered_payload_is_rejected() -> None:
    header, _, signature = make_token().split(".")
    forged = base64.urlsafe_b64encode(json.dumps(claims(sub=new_uuid())).encode()).rstrip(b"=")
    assert_unauthorized(get_me(f"{header}.{forged.decode()}.{signature}"))


def test_unknown_key_id_is_rejected() -> None:
    assert_unauthorized(get_me(make_token(headers={"kid": "not-a-known-key"})))


def test_alg_none_is_rejected() -> None:
    header = _b64url(json.dumps({"alg": "none", "typ": "JWT"}).encode())
    payload = _b64url(json.dumps(claims()).encode())
    assert_unauthorized(get_me(f"{header}.{payload}.signature"))


def test_hs256_rejected_when_no_legacy_secret_configured() -> None:
    assert_unauthorized(get_me(make_hs256_token()))


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def test_public_key_cannot_be_used_as_hmac_secret() -> None:
    # Classic algorithm-confusion attack: an HS256 token whose HMAC key is the
    # server's public key. PyJWT refuses to mint one, so build it by hand.
    public_pem = ES256_KEY.private_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    header = _b64url(json.dumps({"alg": "HS256", "typ": "JWT", "kid": ES256_KEY.kid}).encode())
    payload = _b64url(json.dumps(claims()).encode())
    signature = hmac.new(public_pem, f"{header}.{payload}".encode(), hashlib.sha256).digest()
    token = f"{header}.{payload}.{_b64url(signature)}"
    assert_unauthorized(get_me(token))
    settings = auth_settings(supabase_jwt_secret=LEGACY_SECRET)
    assert_unauthorized(get_me(token, client_for(settings)))


def test_hs256_signed_with_wrong_secret_is_rejected() -> None:
    settings = auth_settings(supabase_jwt_secret=LEGACY_SECRET)
    wrong_secret = "a-different-secret-that-is-long-enough-000"  # noqa: S105 - fake
    token = make_hs256_token(secret=wrong_secret)
    assert_unauthorized(get_me(token, client_for(settings)))


def test_key_whose_algorithm_differs_from_header_is_rejected() -> None:
    # Header claims ES256 but the kid resolves to the RSA key.
    token = make_token(ES256_KEY, headers={"kid": RS256_KEY.kid})
    assert_unauthorized(get_me(token))


# --- Issuer / audience / claims ----------------------------------------------


def test_invalid_issuer_is_rejected() -> None:
    assert_unauthorized(get_me(make_token(iss="https://evil.supabase.co/auth/v1")))


def test_invalid_audience_is_rejected() -> None:
    assert_unauthorized(get_me(make_token(aud="some-other-audience")))


@pytest.mark.parametrize("claim", ["exp", "iat", "sub", "aud", "iss", "role"])
def test_missing_required_claim_is_rejected(claim: str) -> None:
    token_claims = claims()
    del token_claims[claim]
    token = jwt.encode(
        token_claims, ES256_KEY.private_key, algorithm="ES256", headers={"kid": ES256_KEY.kid}
    )
    assert_unauthorized(get_me(token))


def test_non_uuid_subject_is_rejected() -> None:
    assert_unauthorized(get_me(make_token(sub="not-a-uuid")))


@pytest.mark.parametrize("role", ["anon", "service_role", "admin"])
def test_non_authenticated_role_is_rejected(role: str) -> None:
    assert_unauthorized(get_me(make_token(role=role)))


def test_non_numeric_iat_is_rejected() -> None:
    assert_unauthorized(get_me(make_token(iat="yesterday")))


def test_invalid_session_id_claim_is_ignored_not_trusted() -> None:
    principal = fake_verifier().verify(make_token(session_id="not-a-uuid"))
    assert principal.session_id is None
    assert str(principal.user_id) == USER_ID


def test_anonymous_session_is_rejected() -> None:
    assert_unauthorized(get_me(make_token(is_anonymous=True)))


def test_audience_is_configurable() -> None:
    settings = auth_settings(supabase_jwt_audience="custom-aud")
    client = client_for(settings)
    assert get_me(make_token(aud="custom-aud"), client).status_code == 200
    assert_unauthorized(get_me(make_token(), client))


# --- Fail closed --------------------------------------------------------------


def test_auth_not_configured_fails_closed_with_503() -> None:
    settings = Settings(environment="test")  # no SUPABASE_URL
    response = get_me(make_token(), TestClient(create_app(settings)))
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "auth_unavailable"


def test_jwks_outage_fails_closed_with_503() -> None:
    class UnreachableJwks:
        def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
            raise jwt.PyJWKClientConnectionError("connection refused")

    settings = auth_settings()
    response = get_me(
        make_token(), client_for(settings, SupabaseTokenVerifier(settings, UnreachableJwks()))
    )
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "auth_unavailable",
            "message": "Sign-in is temporarily unavailable. Please try again shortly.",
        }
    }


# --- Real PyJWKClient against a mocked JWKS endpoint ---------------------------


def test_pyjwkclient_fetches_project_jwks_once_and_caches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fetched: list[str] = []

    def fake_fetch(self: PyJWKClient) -> Any:
        fetched.append(self.uri)
        data = jwks(ES256_KEY, RS256_KEY)
        if self.jwk_set_cache is not None:
            self.jwk_set_cache.put(data)
        return data

    monkeypatch.setattr(PyJWKClient, "fetch_data", fake_fetch)
    client = client_for(verifier=SupabaseTokenVerifier(auth_settings()))

    assert get_me(make_token(ES256_KEY), client).status_code == 200
    assert get_me(make_token(RS256_KEY), client).status_code == 200
    assert fetched == [f"{ISSUER}/.well-known/jwks.json"]


def test_verifier_key_source_is_used_per_request() -> None:
    source = FakeKeySource(ES256_KEY)
    settings = auth_settings()
    client = client_for(settings, SupabaseTokenVerifier(settings, source))
    get_me(make_token(), client)
    get_me(make_token(), client)
    assert source.calls == 2


# --- Response consistency and logging ----------------------------------------


def test_all_invalid_token_failures_share_one_response() -> None:
    now = int(time.time())
    tokens = [
        make_token(iat=now - 7200, exp=now - 3600),
        make_token(ATTACKER_KEY),
        make_token(iss="https://evil.example/auth/v1"),
        make_token(aud="wrong"),
        "aaaa.bbbb.cccc",
    ]
    bodies = {json.dumps(get_me(token).json(), sort_keys=True) for token in tokens}
    assert len(bodies) == 1


def test_rejections_log_reason_but_never_token(capsys: pytest.CaptureFixture[str]) -> None:
    now = int(time.time())
    token = make_token(iat=now - 7200, exp=now - 3600)
    with client_for() as client:
        get_me(token, client)
    output = capsys.readouterr().out
    assert token not in output
    assert token.split(".")[2] not in output
    rejected = [line for line in parse_log_lines(output) if line["message"] == "auth_rejected"]
    assert [line["reason"] for line in rejected] == ["expired"]


def test_successful_request_does_not_log_token_or_email(
    capsys: pytest.CaptureFixture[str],
) -> None:
    token = make_token()
    with client_for() as client:
        assert get_me(token, client).status_code == 200
    output = capsys.readouterr().out
    assert token not in output
    assert EMAIL not in output
