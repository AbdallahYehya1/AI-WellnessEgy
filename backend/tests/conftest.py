from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest

from app.core.config import Settings, get_settings

# Environment variables that Settings reads. Cleared for every test so the
# developer's shell or a local .env cannot change test outcomes.
_SETTINGS_ENV = [name.upper() for name in Settings.model_fields]

FAKE_SECRETS = {
    "SUPABASE_SERVICE_ROLE_KEY": "fake-service-role-key-6f1c2a",
    "SUPABASE_JWT_SECRET": "fake-jwt-secret-9b7d3e-long-enough-for-validation",
    "DATABASE_URL": "postgresql://user:fake-db-password-41ac@localhost/db",
}


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    for name in _SETTINGS_ENV:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)  # no stray .env file is picked up
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def secret_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    for name, value in FAKE_SECRETS.items():
        monkeypatch.setenv(name, value)
    return FAKE_SECRETS


def parse_log_lines(output: str) -> list[dict[str, object]]:
    return [json.loads(line) for line in output.splitlines() if line.startswith("{")]
