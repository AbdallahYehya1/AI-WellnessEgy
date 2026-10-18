"""Database outages fail fast and closed, with the standard error body and no leaked detail."""

from __future__ import annotations

import time

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.db import (
    CONNECT_TIMEOUT_SECONDS,
    POOL_MAX_OVERFLOW,
    POOL_SIZE,
    SERVERLESS_POOL_SIZE,
    SUPABASE_ROOT_CA,
    engine_for,
    tls_connect_args,
)
from tests.auth_helpers import api_client, auth_settings, bearer
from tests.conftest import parse_log_lines

SECRET_PASSWORD = "not-a-real-password-xyz"  # noqa: S105 - must never reach logs or responses


def _client(host_port: str) -> TestClient:
    url = f"postgresql://wellness:{SECRET_PASSWORD}@{host_port}/wellness"
    return api_client(auth_settings(database_url=url))


def test_refused_connection_returns_standard_503(capsys: pytest.CaptureFixture[str]) -> None:
    with _client("127.0.0.1:1") as client:  # nothing listens on port 1
        capsys.readouterr()
        response = client.get("/me", headers=bearer())
    assert response.status_code == 503
    assert response.json() == {
        "error": {
            "code": "service_unavailable",
            "message": "This service is temporarily unavailable. Please try again shortly.",
        }
    }
    output = capsys.readouterr()
    logs = output.out + output.err
    assert SECRET_PASSWORD not in logs
    assert SECRET_PASSWORD not in response.text
    assert "127.0.0.1:1" not in response.text
    records = [r for r in parse_log_lines(output.out) if r.get("message") == "database_unavailable"]
    assert records and set(records[0]) >= {"error_type"}


def test_unreachable_database_fails_within_the_connect_timeout() -> None:
    assert CONNECT_TIMEOUT_SECONDS < 5  # inside the frontend's 5-second API timeout
    with _client("10.255.255.1:5432") as client:  # non-routable: packets are dropped
        started = time.monotonic()
        response = client.get("/me", headers=bearer())
        elapsed = time.monotonic() - started
    assert response.status_code == 503
    # pool_pre_ping may retry once, so allow two attempts plus overhead.
    assert elapsed < CONNECT_TIMEOUT_SECONDS * 2 + 2


def test_exhausted_pool_fails_fast_with_the_standard_503(
    capsys: pytest.CaptureFixture[str], test_database_url: str
) -> None:
    engine = engine_for(test_database_url)
    held = [engine.connect() for _ in range(POOL_SIZE + POOL_MAX_OVERFLOW)]  # every slot busy
    try:
        with api_client() as client:
            capsys.readouterr()
            started = time.monotonic()
            response = client.get("/me", headers=bearer())
            elapsed = time.monotonic() - started
    finally:
        for conn in held:
            conn.close()
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
    assert elapsed < CONNECT_TIMEOUT_SECONDS + 2  # not SQLAlchemy's 30-second default
    records = [
        r
        for r in parse_log_lines(capsys.readouterr().out)
        if r.get("message") == "database_unavailable"
    ]
    assert records and records[0]["error_type"] == "TimeoutError"


def test_production_requires_tls_to_the_database(test_database_url: str) -> None:
    """The local test server has no TLS, so a production engine must refuse it."""
    engine = engine_for(test_database_url, require_tls=True)
    with pytest.raises(OperationalError) as caught:
        engine.connect().close()
    assert "SSL" in str(caught.value.orig)
    assert engine_for(test_database_url) is not engine  # development keeps its own pool


@pytest.mark.parametrize("mode", ["", "?sslmode=disable", "?sslmode=prefer", "?sslmode=require"])
def test_weaker_modes_become_verify_full_against_the_supabase_ca(mode: str) -> None:
    args = tls_connect_args(f"postgresql://u:p@db.example.org:5432/postgres{mode}", required=True)
    assert args == {"sslmode": "verify-full", "sslrootcert": str(SUPABASE_ROOT_CA)}


def test_supabase_hosts_are_verified_even_outside_production() -> None:
    pooler = "postgresql://u.ref:p@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"
    assert tls_connect_args(pooler)["sslmode"] == "verify-full"
    assert tls_connect_args("postgresql://u:p@localhost:5432/db") == {}


def test_an_explicit_ca_choice_is_kept() -> None:
    url = "postgresql://u:p@h.example.org/db?sslmode=verify-ca&sslrootcert=/etc/ca.pem"
    assert tls_connect_args(url, required=True) == {
        "sslmode": "verify-ca",
        "sslrootcert": "/etc/ca.pem",
    }


def test_bundled_root_ca_is_supabases() -> None:
    cert = x509.load_pem_x509_certificate(SUPABASE_ROOT_CA.read_bytes())
    assert cert.subject.rfc4514_string().startswith("CN=Supabase Root 2021 CA")
    assert cert.fingerprint(hashes.SHA256()).hex() == (
        "807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa"
    )


def test_serverless_profile_keeps_one_connection_per_instance(test_database_url: str) -> None:
    engine = engine_for(test_database_url, serverless=True)
    assert engine.pool.size() == SERVERLESS_POOL_SIZE  # type: ignore[attr-defined]
    assert engine is not engine_for(test_database_url)
