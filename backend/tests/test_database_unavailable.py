"""Database outages fail fast and closed, with the standard error body and no leaked detail."""

from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from app.core.db import CONNECT_TIMEOUT_SECONDS
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
