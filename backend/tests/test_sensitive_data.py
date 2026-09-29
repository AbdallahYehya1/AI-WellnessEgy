"""Sensitive configuration must never be logged or exposed over HTTP."""

from __future__ import annotations

import json
import logging
import sys

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.core.config import Settings
from app.core.logging import REDACTED, JsonFormatter
from app.main import create_app
from tests.conftest import parse_log_lines


def _assert_no_secret_in(text: str, secrets: dict[str, str]) -> None:
    for value in secrets.values():
        assert value not in text


def test_settings_repr_str_and_dump_mask_secrets(secret_env: dict[str, str]) -> None:
    settings = Settings()
    _assert_no_secret_in(repr(settings), secret_env)
    _assert_no_secret_in(str(settings), secret_env)
    _assert_no_secret_in(str(settings.model_dump()), secret_env)
    _assert_no_secret_in(settings.model_dump_json(), secret_env)


def test_secrets_not_in_logs_across_app_lifecycle(
    secret_env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    with TestClient(create_app(Settings())) as client:
        client.get("/health")
    output = capsys.readouterr()
    assert parse_log_lines(output.out)  # logging actually happened
    _assert_no_secret_in(output.out + output.err, secret_env)


def test_secrets_not_exposed_over_http(secret_env: dict[str, str]) -> None:
    with TestClient(create_app(Settings())) as client:
        responses = [client.get(path) for path in ("/health", "/openapi.json", "/docs")]
    for response in responses:
        _assert_no_secret_in(response.text, secret_env)
        _assert_no_secret_in(json.dumps(dict(response.headers)), secret_env)


def test_health_exposes_no_configuration_fields(secret_env: dict[str, str]) -> None:
    body = TestClient(create_app(Settings())).get("/health").json()
    assert set(body) == {"status", "environment"}


def test_request_log_omits_query_string_and_headers(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with TestClient(create_app(Settings())) as client:
        client.get(
            "/health?access_token=query-token-123",
            headers={"Authorization": "Bearer header-token-456"},
        )
    output = capsys.readouterr().out
    assert "query-token-123" not in output
    assert "header-token-456" not in output
    request_logs = [line for line in parse_log_lines(output) if line["message"] == "http_request"]
    assert request_logs[-1]["path"] == "/health"
    assert request_logs[-1]["status_code"] == 200


def _format(**extra: object) -> dict[str, object]:
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "event", (), None)
    record.__dict__.update(extra)
    result: dict[str, object] = json.loads(JsonFormatter().format(record))
    return result


@pytest.mark.parametrize(
    "key",
    ["password", "api_key", "access_token", "Authorization", "supabase_jwt_secret", "database_url"],
)
def test_formatter_redacts_sensitive_field_names(key: str) -> None:
    assert _format(**{key: "leak-me"})[key] == REDACTED


def test_formatter_redacts_secretstr_values_and_nested_keys() -> None:
    payload = _format(value=SecretStr("leak-me"), context={"token": "leak-me", "ok": 1})
    assert payload["value"] == REDACTED
    assert payload["context"] == {"token": REDACTED, "ok": 1}


def test_formatter_includes_exception_traceback() -> None:
    try:
        raise ValueError("boom")
    except ValueError:
        record = logging.LogRecord(
            "test", logging.ERROR, __file__, 1, "failed", (), exc_info=sys.exc_info()
        )
    payload = json.loads(JsonFormatter().format(record))
    assert "ValueError: boom" in payload["exc_info"]


def test_formatter_keeps_safe_fields() -> None:
    payload = _format(request_id="abc", status_code=200)
    assert payload["request_id"] == "abc"
    assert payload["status_code"] == 200
    assert payload["level"] == "INFO"
    assert payload["message"] == "event"
