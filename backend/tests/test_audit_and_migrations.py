"""Audit-log guarantees and the migration itself."""

from __future__ import annotations

import uuid

import pytest
import sqlalchemy as sa
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import Engine, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.audit.service import AuditMetadataError, record_event
from app.core.db import SCHEMA, Base
from tests.auth_helpers import api_client, bearer
from tests.conftest import alembic_config

# --- Audit writer -------------------------------------------------------------


@pytest.mark.parametrize(
    "metadata",
    [
        {"note": "free text with spaces"},
        {"email": "person@example.com"},
        {"token": "a" * 65},
        {"bad key!": "x"},
        {"fields": ["ok", "not ok"]},
        {"nested": {"a": "b"}},
    ],
)
def test_audit_metadata_rejects_non_reference_values(
    metadata: dict[str, object], db_engine: Engine
) -> None:
    with Session(db_engine) as session, pytest.raises(AuditMetadataError):
        record_event(
            session,
            action="user.created",
            actor_user_id=None,
            target_type="user",
            target_id=None,
            metadata=metadata,  # type: ignore[arg-type]  # deliberately invalid
        )


def test_audit_metadata_rejects_too_many_keys(db_engine: Engine) -> None:
    with Session(db_engine) as session, pytest.raises(AuditMetadataError):
        record_event(
            session,
            action="user.created",
            actor_user_id=None,
            target_type="user",
            target_id=None,
            metadata={f"k{i}": i for i in range(11)},
        )


def test_audit_metadata_accepts_reference_values(db_engine: Engine) -> None:
    target = uuid.uuid4()
    with Session(db_engine, expire_on_commit=False) as session, session.begin():
        event = record_event(
            session,
            action="consent.recorded",
            actor_user_id=None,
            target_type="consent",
            target_id=target,
            metadata={"version": "2026-09-29.draft-1", "granted": True, "ref": target, "n": 3},
        )
    assert event.metadata_ == {
        "version": "2026-09-29.draft-1",
        "granted": True,
        "ref": str(target),
        "n": 3,
    }


@pytest.mark.parametrize(
    "statement", ["UPDATE app.audit_events SET action = 'x'", "DELETE FROM app.audit_events"]
)
def test_audit_events_are_append_only_in_the_database(statement: str, db_engine: Engine) -> None:
    api_client().get("/me", headers=bearer())  # writes a user.created event
    with pytest.raises(DBAPIError, match="append-only"), db_engine.begin() as connection:
        connection.execute(text(statement))
    with db_engine.connect() as connection:
        assert connection.execute(text("SELECT count(*) FROM app.audit_events")).scalar_one() == 1


# --- Migration ----------------------------------------------------------------


def test_models_match_the_migration(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        context = MigrationContext.configure(
            connection,
            opts={
                "include_schemas": True,
                "include_name": lambda name, type_, _p: type_ != "schema" or name == SCHEMA,
                "compare_type": True,
                "version_table_schema": SCHEMA,
            },
        )
        diff = compare_metadata(context, Base.metadata)
    assert diff == []


def test_tables_live_in_app_schema_with_rls_enabled(db_engine: Engine) -> None:
    with db_engine.connect() as connection:
        found = connection.execute(
            text(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c "
                "JOIN pg_namespace n ON n.oid = c.relnamespace "
                "WHERE n.nspname = 'app' AND c.relkind = 'r' ORDER BY c.relname"
            )
        ).all()
        public: int = connection.execute(
            text(
                "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' "
                "AND table_name IN ('users', 'consents', 'audit_events')"
            )
        ).scalar_one()
    assert [(name, rls) for name, rls in found if name != "alembic_version"] == [
        ("audit_events", True),
        ("consents", True),
        ("users", True),
    ]
    assert public == 0


def test_migration_downgrades_and_reapplies_cleanly(
    test_database_url: str, db_engine: Engine
) -> None:
    config = alembic_config(test_database_url)
    command.downgrade(config, "base")
    inspector = sa.inspect(db_engine)
    assert [t for t in inspector.get_table_names(schema=SCHEMA) if t != "alembic_version"] == []
    command.upgrade(config, "head")
    assert set(sa.inspect(db_engine).get_table_names(schema=SCHEMA)) >= {
        "users",
        "consents",
        "audit_events",
    }


def _has_privilege(engine: Engine, sql: str, **params: str) -> bool:
    with engine.connect() as connection:
        return bool(connection.execute(text(sql), params).scalar_one())


CREATE_SUPABASE_ROLES = (
    "DO $$ BEGIN "
    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') "
    "THEN CREATE ROLE anon NOLOGIN; END IF; "
    "IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') "
    "THEN CREATE ROLE authenticated NOLOGIN; END IF; "
    "END $$"
)


def test_supabase_data_api_roles_get_no_access(test_database_url: str, db_engine: Engine) -> None:
    """Simulate Supabase's `anon`/`authenticated` roles and re-run the migration."""
    config = alembic_config(test_database_url)
    with db_engine.begin() as connection:
        connection.execute(text(CREATE_SUPABASE_ROLES))
    try:
        command.downgrade(config, "base")
        with db_engine.begin() as connection:
            # Mimic Supabase-style broad grants that the migration must remove.
            connection.execute(text("GRANT USAGE ON SCHEMA app TO anon, authenticated"))
        command.upgrade(config, "head")
        for role in ("anon", "authenticated"):
            assert not _has_privilege(
                db_engine, "SELECT has_schema_privilege(:r, 'app', 'USAGE')", r=role
            )
            for table in ("app.users", "app.consents", "app.audit_events"):
                assert not _has_privilege(
                    db_engine, "SELECT has_table_privilege(:r, :t, 'SELECT')", r=role, t=table
                )
    finally:
        with db_engine.begin() as connection:
            connection.execute(text("DROP OWNED BY anon, authenticated"))
            connection.execute(text("DROP ROLE IF EXISTS anon, authenticated"))
