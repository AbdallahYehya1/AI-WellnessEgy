from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import SecretStr, ValidationError

from app.core.config import Settings, get_settings


def test_defaults_are_safe_without_any_configuration() -> None:
    settings = Settings()
    assert settings.environment == "development"
    assert settings.log_level == "INFO"
    assert settings.is_production is False
    assert settings.docs_enabled is True
    assert settings.database_url is None
    assert settings.supabase_service_role_key is None
    assert settings.supabase_jwt_secret is None


def test_environment_variables_override_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("LOG_LEVEL", "WARNING")
    settings = Settings()
    assert settings.environment == "production"
    assert settings.log_level == "WARNING"
    assert settings.is_production is True
    assert settings.docs_enabled is False


def test_env_var_names_are_case_insensitive(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("environment", "staging")
    assert Settings().environment == "staging"


def test_dotenv_file_is_loaded(tmp_path: Path) -> None:
    (tmp_path / ".env").write_text("ENVIRONMENT=staging\n", encoding="utf-8")
    assert Settings().environment == "staging"


def test_real_environment_takes_precedence_over_dotenv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / ".env").write_text("ENVIRONMENT=staging\n", encoding="utf-8")
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert Settings().environment == "production"


@pytest.mark.parametrize(("name", "value"), [("ENVIRONMENT", "prod"), ("LOG_LEVEL", "LOUD")])
def test_invalid_values_are_rejected(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        Settings()


def test_unknown_environment_variables_are_ignored(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SOME_UNRELATED_VARIABLE", "x")
    assert not hasattr(Settings(), "some_unrelated_variable")


def test_secrets_are_loaded_as_secret_strings(secret_env: dict[str, str]) -> None:
    settings = Settings()
    assert isinstance(settings.supabase_service_role_key, SecretStr)
    assert (
        settings.supabase_service_role_key.get_secret_value()
        == secret_env["SUPABASE_SERVICE_ROLE_KEY"]
    )


def test_get_settings_is_cached() -> None:
    assert get_settings() is get_settings()
