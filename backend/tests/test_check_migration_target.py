"""The read-only pre-migration check reports the target state and never writes."""

from __future__ import annotations

import json

from sqlalchemy import Engine, text

from app.ops.check_migration_target import inspect_target


def test_reports_head_revision_and_matching_tables(db_engine: Engine) -> None:
    report = inspect_target(db_engine)
    assert report["alembic_revision"] == "0003"
    assert report["app_schema_exists"] is True
    assert report["tables_match_revision"] is True
    assert "users" in report["app_tables"]
    assert set(report) >= {
        "host",
        "port",
        "database",
        "user",
        "supabase_roles_present",
        "can_create_schema",
    }


def test_never_reports_the_password(db_engine: Engine) -> None:
    password = db_engine.url.password
    assert password
    report = inspect_target(db_engine)
    assert not any("password" in key for key in report)
    assert f":{password}@" not in json.dumps(report)


def test_runs_in_a_read_only_transaction(db_engine: Engine) -> None:
    before = _count(db_engine)
    inspect_target(db_engine)
    assert _count(db_engine) == before


def _count(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.execute(text("select count(*) from app.users")).scalar_one())
