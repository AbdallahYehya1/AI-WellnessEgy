"""Pasted or invalid chat variables never take the API down (2026-10-20 outages)."""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings, get_settings
from app.main import build_chat_runtime, create_app
from tests.auth_helpers import auth_settings, fake_verifier
from tests.conftest import parse_log_lines


@pytest.fixture(autouse=True)
def _fresh_settings() -> Iterator[None]:
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.mark.parametrize(
    ("name", "pasted", "field", "expected"),
    [
        ("CHAT_DEMO_ACCESS", "all_consented_adults\n", "chat_demo_access", "all_consented_adults"),
        (
            "CHAT_DEMO_ACCESS",
            ' "All_Consented_Adults" ',
            "chat_demo_access",
            "all_consented_adults",
        ),
        ("CHAT_PROVIDER", "Groq\r\n", "chat_provider", "groq"),
        ("CHAT_ENABLED", "true\n", "chat_enabled", True),
        ("CHAT_DEMO_CURATED", " TRUE ", "chat_demo_curated", True),
        ("CHAT_EXTERNAL_PROVIDER_APPROVED", "'true'", "chat_external_provider_approved", True),
        ("CHAT_PROVIDER_DAILY_LIMIT", '"60"', "chat_provider_daily_limit", 60),
        (
            "CHAT_SAFETY_POLICY",
            "curated-educational-demo-v1\n",
            "chat_safety_policy",
            "curated-educational-demo-v1",
        ),
        ("CHAT_SAFETY_POLICY", "  ", "chat_safety_policy", None),
        ("GROQ_MODEL", " openai/gpt-oss-20b\n", "groq_model", "openai/gpt-oss-20b"),
        ("ENVIRONMENT", "Production\n", "environment", "production"),
        ("LOG_LEVEL", "info\n", "log_level", "INFO"),
    ],
)
def test_pasted_values_are_tidied(
    monkeypatch: pytest.MonkeyPatch, name: str, pasted: str, field: str, expected: object
) -> None:
    monkeypatch.setenv(name, pasted)
    assert getattr(Settings(_env_file=None), field) == expected


def test_an_invalid_chat_variable_disables_chat_only(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("CHAT_ENABLED", "true")
    monkeypatch.setenv("CHAT_DEMO_ACCESS", "everyone")  # not an access mode
    monkeypatch.setenv("CHAT_PROVIDER_DAILY_LIMIT", "lots")
    settings = get_settings()
    assert settings.chat_config_problems() == [
        "invalid value for CHAT_DEMO_ACCESS",
        "invalid value for CHAT_PROVIDER_DAILY_LIMIT",
    ]
    assert build_chat_runtime(settings) is None
    capsys.readouterr()
    client = TestClient(create_app(settings, fake_verifier(settings)))  # configures logging
    record = next(
        r for r in parse_log_lines(capsys.readouterr().out) if r.get("message") == "chat_disabled"
    )
    reason = str(record["reason"])
    assert "CHAT_DEMO_ACCESS" in reason
    assert "everyone" not in reason and "lots" not in reason  # names only
    assert client.get("/health").status_code == 200


def test_other_invalid_variables_still_stop_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "prod")  # never guess the environment: fail closed
    monkeypatch.setenv("CHAT_DEMO_ACCESS", "everyone")
    with pytest.raises(ValidationError):
        get_settings()


def test_a_failure_while_building_chat_never_takes_down_the_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def broken(_: Settings) -> None:
        raise RuntimeError("provider construction failed")

    monkeypatch.setattr("app.main.build_chat_runtime", broken)
    settings = auth_settings()
    app = create_app(settings, fake_verifier(settings))
    assert app.state.chat_runtime is None
    assert TestClient(app).get("/health").status_code == 200
