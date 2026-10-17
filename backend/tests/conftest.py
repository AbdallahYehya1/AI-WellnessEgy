from __future__ import annotations

import json
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import Engine, text

from app.core.config import Settings, get_settings
from app.core.db import engine_for

BACKEND_DIR = Path(__file__).resolve().parents[1]

# Environment variables that Settings reads. Cleared for every test so the
# developer's shell or a local .env cannot change test outcomes.
_SETTINGS_ENV = [name.upper() for name in Settings.model_fields]

FAKE_SECRETS = {
    "SUPABASE_SERVICE_ROLE_KEY": "fake-service-role-key-6f1c2a",
    "SUPABASE_JWT_SECRET": "fake-jwt-secret-9b7d3e-long-enough-for-validation",
    "DATABASE_URL": "postgresql://user:fake-db-password-41ac@localhost/db",
}


def alembic_config(database_url: str) -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    config.attributes["database_url"] = database_url
    config.attributes["configure_logger"] = False
    return config


@pytest.fixture(scope="session", autouse=True)
def test_database_url() -> Iterator[str]:
    """A migrated, disposable Postgres for the whole run.

    Uses TEST_DATABASE_URL when set (CI service container); otherwise starts
    a throwaway postgres:17 container with testcontainers (needs Docker).
    """
    url = os.environ.get("TEST_DATABASE_URL")
    container = None
    if not url:
        from testcontainers.community.postgres import PostgresContainer

        container = PostgresContainer("postgres:17-alpine", driver="psycopg")
        container.start()
        url = container.get_connection_url()
        os.environ["TEST_DATABASE_URL"] = url
    command.upgrade(alembic_config(url), "head")
    try:
        yield url
    finally:
        engine_for(url).dispose()
        if container is not None:
            container.stop()
            os.environ.pop("TEST_DATABASE_URL", None)


@pytest.fixture
def db_engine(test_database_url: str) -> Engine:
    return engine_for(test_database_url)


@pytest.fixture(autouse=True)
def clean_database(test_database_url: str) -> Iterator[None]:
    yield
    # TRUNCATE is used for test isolation only; application code never
    # truncates, and row-level UPDATE/DELETE on audit_events is blocked.
    with engine_for(test_database_url).begin() as connection:
        connection.execute(
            text(
                "TRUNCATE app.audit_events, app.mood_checkins, app.consents, app.safety_events, "
                "app.chat_rate_events, app.knowledge_chunks, app.knowledge_sources, app.users"
            )
        )


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
