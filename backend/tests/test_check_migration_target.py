"""The read-only pre-migration check verifies its target first and never writes."""

from __future__ import annotations

import json

import pytest
from sqlalchemy import Engine, NullPool, create_engine, text

from app.ops import check_migration_target as checker
from app.ops.check_migration_target import describe_target, inspect_target, redact

REF = "abcdefghijklmnopqrst"
SUPABASE_URL = f"https://{REF}.supabase.co"
PASSWORD = "pooler-secret-9f2c"  # noqa: S105 - fake, must never be printed
SESSION_POOLER = (
    f"postgresql://postgres.{REF}:{PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres"
)


def test_session_pooler_for_the_same_project_is_accepted() -> None:
    target = describe_target(SESSION_POOLER, SUPABASE_URL)
    assert target["connection_mode"] == "session_pooler"
    assert target["project_ref"] == REF
    assert target["problems"] == []
    assert PASSWORD not in json.dumps(target)


def test_slash_and_colon_in_the_password_parse_cleanly() -> None:
    url = SESSION_POOLER.replace(f":{PASSWORD}@", f":x/{PASSWORD}:y@")
    target = describe_target(url, SUPABASE_URL)
    assert target["connection_mode"] == "session_pooler"
    assert target["database"] == "postgres"
    assert PASSWORD not in json.dumps(target)


@pytest.mark.parametrize(
    ("database_url", "supabase_url", "problem"),
    [
        (SESSION_POOLER.replace(":5432/", ":6543/"), SUPABASE_URL, "transaction_pooler"),
        (
            f"postgresql://postgres:{PASSWORD}@db.{REF}.supabase.co:5432/postgres",
            SUPABASE_URL,
            "direct",
        ),
        (f"postgresql://postgres:{PASSWORD}@localhost:5432/postgres", SUPABASE_URL, "not_supabase"),
        (SESSION_POOLER, "https://zzzzzzzzzzzzzzzzzzzz.supabase.co", "does not match"),
        (SESSION_POOLER, None, "SUPABASE_URL is not set"),
    ],
)
def test_wrong_targets_are_refused(
    database_url: str, supabase_url: str | None, problem: str
) -> None:
    target = describe_target(database_url, supabase_url)
    assert any(problem in p for p in target["problems"])
    assert PASSWORD not in json.dumps(target)


@pytest.mark.parametrize(
    "database_url",
    [
        # unencoded "@": the tail of the password would otherwise land in the host
        f"postgresql://postgres.{REF}:pa@ss{PASSWORD}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
        SESSION_POOLER.replace(":5432/", ":54x2/"),
        "not a url",
    ],
)
def test_malformed_urls_print_nothing_and_are_refused(database_url: str) -> None:
    target = describe_target(database_url, SUPABASE_URL)
    assert target["connection_mode"] == "unparsable"
    assert target["host"] is target["user"] is target["database"] is None
    assert target["problems"]
    assert PASSWORD not in json.dumps(target)
    assert "ss" + PASSWORD not in json.dumps(target)


def test_refused_target_never_connects(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", SESSION_POOLER)
    monkeypatch.setenv("SUPABASE_URL", "https://zzzzzzzzzzzzzzzzzzzz.supabase.co")

    def no_connection(*_: object, **__: object) -> None:
        raise AssertionError("must not connect")

    monkeypatch.setattr(checker, "create_engine", no_connection)
    assert checker.run([]) == 3
    output = capsys.readouterr()
    assert "Refusing to connect" in output.err
    assert PASSWORD not in output.out + output.err


def test_target_only_prints_target_without_connecting(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", SESSION_POOLER)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setattr(checker, "create_engine", lambda *_, **__: pytest.fail("must not connect"))
    assert checker.run(["--target-only"]) == 0
    output = capsys.readouterr()
    assert json.loads(output.out)["target"]["project_ref"] == REF
    assert PASSWORD not in output.out + output.err


def test_missing_database_url_exits_without_connecting(capsys: pytest.CaptureFixture[str]) -> None:
    assert checker.run([]) == 2
    assert "never paste it into chat" in capsys.readouterr().err


def test_failed_connection_reports_the_error_type_without_the_password(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("DATABASE_URL", SESSION_POOLER)
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    refused = f"postgresql+psycopg://postgres.{REF}:{PASSWORD}@127.0.0.1:1/postgres"
    monkeypatch.setattr(checker, "create_engine", lambda _url, **kw: create_engine(refused, **kw))
    assert checker.run([]) == 1
    output = capsys.readouterr()
    # psycopg raises OperationalError or its subclass ConnectionTimeout, by platform.
    assert json.loads(output.err)["error"] in {"OperationalError", "ConnectionTimeout"}
    assert PASSWORD not in output.out + output.err


def test_connection_errors_are_redacted() -> None:
    message = f'connection to "x" failed: password "{PASSWORD}" for user\nmore detail'
    assert redact(message, PASSWORD) == 'connection to "x" failed: password "***" for user'
    assert redact("p%40ss rejected", "p@ss") == "*** rejected"


def test_reports_head_revision_rls_and_counts(db_engine: Engine) -> None:
    report = inspect_target(db_engine)
    assert report["read_only_transaction"] is True
    assert report["alembic_revision"] == "0003"
    assert report["state"] == "at_revision_0003"
    assert report["app_schema_exists"] is True
    assert report["tables_match_revision"] is True
    assert report["public_alembic_version_exists"] is False
    assert set(report["app_row_counts"]) == set(report["app_tables"])
    assert report["rls_enabled"] == dict.fromkeys(report["app_tables"], True)
    assert report["data_api_roles_with_app_usage"] == []
    assert "app" in report["schemas"]
    assert "users" in report["app_tables"]
    assert set(report) >= {
        "host",
        "port",
        "database",
        "user",
        "supabase_roles_present",
        "can_create_schema",
    }


def test_reports_a_fresh_database(db_engine: Engine) -> None:
    with db_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        conn.execute(text("DROP DATABASE IF EXISTS checker_fresh"))
        conn.execute(text("CREATE DATABASE checker_fresh"))
    fresh = create_engine(db_engine.url.set(database="checker_fresh"), poolclass=NullPool)
    try:
        report = inspect_target(fresh)
    finally:
        fresh.dispose()
        with db_engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
            conn.execute(text("DROP DATABASE checker_fresh"))
    assert report["state"] == "fresh"
    assert report["alembic_revision"] is None
    assert report["app_schema_exists"] is False
    assert report["app_tables"] == []
    assert report["tables_match_revision"] is True
    assert report["auth_users_count"] is None
    assert report["can_create_schema"] is True


def test_never_reports_the_password(db_engine: Engine) -> None:
    password = db_engine.url.password
    assert password
    report = inspect_target(db_engine)
    assert not any("password" in key for key in report)
    assert f":{password}@" not in json.dumps(report)


def test_leaves_no_trace(db_engine: Engine) -> None:
    before = _fingerprint(db_engine)
    inspect_target(db_engine)
    assert _fingerprint(db_engine) == before


def _fingerprint(engine: Engine) -> tuple[int, int, str | None]:
    with engine.connect() as conn:
        users = int(conn.execute(text("select count(*) from app.users")).scalar_one())
        objects = int(conn.execute(text("select count(*) from pg_class")).scalar_one())
        revision = conn.execute(
            text("select version_num from app.alembic_version")
        ).scalar_one_or_none()
    return users, objects, revision
