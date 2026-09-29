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


def test_supabase_is_unconfigured_by_default() -> None:
    settings = Settings()
    assert settings.supabase_url is None
    assert settings.supabase_issuer is None
    assert settings.supabase_jwks_url is None
    assert settings.supabase_jwt_audience == "authenticated"


def test_supabase_urls_are_derived_from_project_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co/")
    settings = Settings()
    assert settings.supabase_url == "https://abc.supabase.co"
    assert settings.supabase_issuer == "https://abc.supabase.co/auth/v1"
    assert settings.supabase_jwks_url == "https://abc.supabase.co/auth/v1/.well-known/jwks.json"


def test_blank_supabase_url_means_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "   ")
    assert Settings().supabase_url is None


def test_local_supabase_may_use_http(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_URL", "http://127.0.0.1:54321")
    assert Settings().supabase_issuer == "http://127.0.0.1:54321/auth/v1"


@pytest.mark.parametrize(
    "url",
    [
        "http://abc.supabase.co",
        "http://localhost.evil.example",
        "http://127.0.0.1.evil.example",
        "ftp://abc.supabase.co",
        "abc.supabase.co",
        "https://",
    ],
)
def test_remote_supabase_url_must_use_https(monkeypatch: pytest.MonkeyPatch, url: str) -> None:
    monkeypatch.setenv("SUPABASE_URL", url)
    with pytest.raises(ValidationError):
        Settings()


@pytest.mark.parametrize(
    "name", ["SUPABASE_JWT_SECRET", "DATABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
)
def test_blank_secret_env_var_means_unset(monkeypatch: pytest.MonkeyPatch, name: str) -> None:
    monkeypatch.setenv(name, "")
    assert getattr(Settings(), name.lower()) is None


def test_example_env_file_loads_with_everything_unset(tmp_path: Path) -> None:
    example = Path(__file__).resolve().parents[2] / ".env.example"
    (tmp_path / ".env").write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    settings = Settings()
    assert settings.supabase_url is None
    assert settings.supabase_jwt_secret is None
    assert settings.database_url is None


def test_short_legacy_jwt_secret_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "too-short")
    with pytest.raises(ValidationError):
        Settings()
