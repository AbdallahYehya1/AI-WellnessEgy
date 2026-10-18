"""Database outages fail fast and closed, with the standard error body and no leaked detail."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core.db import CONNECT_TIMEOUT_SECONDS, POOL_MAX_OVERFLOW, POOL_SIZE, engine_for
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


@pytest.mark.parametrize("mode", ["disable", "allow", "prefer"])
def test_production_overrides_weaker_sslmodes(mode: str, test_database_url: str) -> None:
    url = f"{test_database_url}?sslmode={mode}"
    with pytest.raises(OperationalError):
        engine_for(url, require_tls=True).connect().close()


def test_production_keeps_certificate_verification_when_asked(test_database_url: str) -> None:
    url = f"{test_database_url}?sslmode=verify-full"
    # No override is added (same pool as without require_tls), so verify-full stands.
    assert engine_for(url, require_tls=True) is engine_for(url)
