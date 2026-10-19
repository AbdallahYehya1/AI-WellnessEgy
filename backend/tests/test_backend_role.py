"""The least-privilege `app_backend` role runs every non-chat journey and nothing more."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, NullPool, create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import DBAPIError, ProgrammingError
from sqlalchemy.orm import Session

from app.consent.catalog import PLACEHOLDER_V1
from app.core.db import engine_for
from app.knowledge.ingest import ingest_directory
from app.main import create_app
from app.ops.backend_role import (
    ROLE,
    apply_role,
    redacted_sql,
    role_sql,
    role_url,
    scram_verifier,
    verify_role,
)
from tests.auth_helpers import USER_B_ID, api_client, auth_settings, bearer, fake_verifier
from tests.test_chat import make_runtime

PASSWORD = "role-test-password-7c1d"  # noqa: S105 - fake, test database only


@pytest.fixture
def role_url_for_tests(db_engine: Engine, test_database_url: str) -> Iterator[str]:
    with db_engine.begin() as conn:
        apply_role(conn, PASSWORD, expected_revision=None)  # the test database is at head
    url = role_url(test_database_url, PASSWORD, project_ref=None)
    yield url
    # Pooled sessions keep the dropped role's identity; a recreated role is a new one.
    engine_for(url).dispose()
    with db_engine.begin() as conn:
        conn.execute(text(f"DROP OWNED BY {ROLE}"))
        conn.execute(text(f"DROP ROLE {ROLE}"))


def _as_role(url: str) -> Engine:
    return create_engine(
        url.replace("postgresql://", "postgresql+psycopg://", 1), poolclass=NullPool
    )


def test_every_non_chat_journey_works_as_the_role(
    role_url_for_tests: str, db_engine: Engine
) -> None:
    client = api_client(auth_settings(database_url=role_url_for_tests))
    assert client.get("/profile", headers=bearer()).status_code == 200  # insert-or-get + FOR UPDATE
    assert (
        client.patch("/profile", headers=bearer(), json={"display_name": "Test"}).status_code == 200
    )
    consent = {"version": PLACEHOLDER_V1.version, "granted": True, "consent_type": "required"}
    assert client.post("/consents", headers=bearer(), json=consent).status_code == 201
    assert client.get("/consents/me", headers=bearer()).status_code == 200
    assert (
        client.post("/mood/checkins", headers=bearer(), json={"mood_score": 4}).status_code == 201
    )
    history = client.get("/mood/history", headers=bearer())
    assert history.status_code == 200
    assert len(history.json()["checkins"]) == 1
    with db_engine.connect() as conn:  # audit rows were appended by the role
        actions = {r[0] for r in conn.execute(text("select action from app.audit_events"))}
    assert {
        "user.created",
        "consent.recorded",
        "mood.checkin_recorded",
        "user.profile_updated",
    } <= actions


def test_ownership_still_holds_as_the_role(role_url_for_tests: str) -> None:
    client = api_client(auth_settings(database_url=role_url_for_tests))
    consent = {"version": PLACEHOLDER_V1.version, "granted": True, "consent_type": "required"}
    client.post("/consents", headers=bearer(), json=consent)
    client.post("/mood/checkins", headers=bearer(), json={"mood_score": 4})
    client.post("/consents", headers=bearer(sub=USER_B_ID), json=consent)
    other = client.get("/mood/history", headers=bearer(sub=USER_B_ID))
    assert other.status_code == 200
    assert other.json()["checkins"] == []


@pytest.mark.parametrize(
    "statement",
    [
        "DELETE FROM app.users",
        "TRUNCATE app.mood_checkins",
        "UPDATE app.consents SET granted = false",
        "UPDATE app.mood_checkins SET mood_score = 1",
        "UPDATE app.audit_events SET action = 'x'",
        "DELETE FROM app.audit_events",
        "SELECT action FROM app.audit_events",
        # 0003 grants: knowledge is read-only, the limiter cannot rewrite history.
        "DELETE FROM app.knowledge_chunks",
        "INSERT INTO app.knowledge_sources (slug) VALUES ('x')",
        "UPDATE app.chat_rate_events SET user_id = user_id",
        "SELECT reason_code FROM app.safety_events",
        "CREATE TABLE app.extra (id int)",
        "CREATE TABLE public.extra (id int)",
        "ALTER TABLE app.users DISABLE ROW LEVEL SECURITY",
        "CREATE ROLE sneaky",
    ],
)
def test_everything_else_is_denied(role_url_for_tests: str, statement: str) -> None:
    engine = _as_role(role_url_for_tests)
    try:
        with engine.connect() as conn, pytest.raises(DBAPIError) as caught:
            conn.execute(text(statement))
    finally:
        engine.dispose()
    assert type(caught.value.orig).__name__ == "InsufficientPrivilege"


def test_without_bypassrls_rls_denies_the_backend(
    role_url_for_tests: str, db_engine: Engine
) -> None:
    """Why the role needs BYPASSRLS: RLS is on with no policies (deny-all)."""
    with db_engine.begin() as conn:
        conn.execute(text(f"ALTER ROLE {ROLE} NOBYPASSRLS"))
    engine = _as_role(role_url_for_tests)
    try:
        with engine.connect() as conn, pytest.raises(ProgrammingError) as caught:
            conn.execute(
                text(
                    "INSERT INTO app.users (id, supabase_user_id) "
                    "VALUES (gen_random_uuid(), gen_random_uuid())"
                )
            )
    finally:
        engine.dispose()
    assert "row-level security" in str(caught.value.orig)


def test_verify_report_matches_the_design(role_url_for_tests: str) -> None:
    engine = _as_role(role_url_for_tests)
    try:
        with engine.connect() as conn:
            report = verify_role(conn)
    finally:
        engine.dispose()
    assert report["current_user"] == ROLE
    assert report["bypassrls"] is True
    assert report["superuser"] is report["createrole"] is report["createdb"] is False
    assert report["settings"]["statement_timeout"] == "5s"
    assert report["table_privileges"]["audit_events"] == ["INSERT"]
    # The test database is at 0003, so the chat grant set applies.
    assert report["grant_set"] == "0003"
    assert report["table_privileges"]["chat_rate_events"] == ["SELECT", "INSERT", "DELETE"]
    assert report["table_privileges"]["knowledge_chunks"] == ["SELECT"]
    assert report["table_privileges"]["safety_events"] == ["INSERT"]
    assert report["problems"] == []


def test_apply_is_idempotent_and_removes_drift(role_url_for_tests: str, db_engine: Engine) -> None:
    with db_engine.begin() as conn:
        conn.execute(text(f"GRANT DELETE ON app.users TO {ROLE}"))
        apply_role(conn, PASSWORD, expected_revision=None)
    engine = _as_role(role_url_for_tests)
    try:
        with engine.connect() as conn:
            assert verify_role(conn)["table_privileges"]["users"] == ["SELECT", "INSERT", "UPDATE"]
    finally:
        engine.dispose()


def test_apply_refuses_an_unexpected_revision(db_engine: Engine) -> None:
    with (
        db_engine.begin() as conn,
        pytest.raises(RuntimeError, match="revision '0004'; expected 0002"),
    ):
        apply_role(conn, PASSWORD, expected_revision="0002")  # the test database is at 0003
    with db_engine.connect() as conn:
        assert (
            conn.execute(
                text("select count(*) from pg_roles where rolname = :r"), {"r": ROLE}
            ).scalar()
            == 0
        )


def test_the_plaintext_password_never_reaches_the_server(
    role_url_for_tests: str, db_engine: Engine
) -> None:
    with db_engine.connect() as conn:
        stored: str = conn.execute(
            text("select rolpassword from pg_authid where rolname = :r"), {"r": ROLE}
        ).scalar_one()
    assert stored.startswith("SCRAM-SHA-256$4096:")
    assert PASSWORD not in stored
    assert all(PASSWORD not in s for s in role_sql(scram_verifier(PASSWORD), exists=True))
    assert all("SCRAM-SHA-256$" not in s for s in redacted_sql())


def test_a_failing_role_statement_never_reveals_the_sql(db_engine: Engine) -> None:
    with db_engine.connect() as conn:
        conn.execute(text("SET LOCAL ROLE pg_read_all_data"))  # a role that cannot create roles
        with pytest.raises(RuntimeError) as caught:
            apply_role(conn, PASSWORD, expected_revision=None)
        conn.rollback()
    message = str(caught.value)
    assert message.startswith("role statement 0 failed:")
    assert "SCRAM" not in message
    assert caught.value.__cause__ is None
    assert caught.value.__suppress_context__


def test_scram_verifier_matches_postgres(db_engine: Engine, test_database_url: str) -> None:
    """A login with the plaintext succeeds against the locally computed verifier."""
    with db_engine.begin() as conn:
        verifier = scram_verifier("probe-pw")
        conn.exec_driver_sql(f"CREATE ROLE scram_probe LOGIN PASSWORD '{verifier}'")
    url = make_url(test_database_url).set(
        drivername="postgresql+psycopg",
        username="scram_probe",
        password="probe-pw",  # noqa: S106
    )
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            assert conn.execute(text("select current_user")).scalar() == "scram_probe"
    finally:
        engine.dispose()
        with db_engine.begin() as conn:
            conn.execute(text("DROP ROLE scram_probe"))


def test_pooler_url_uses_role_dot_ref_and_the_transaction_pooler() -> None:
    owner = "postgresql://postgres.abcdefghijklmnopqrst:owner-pw@aws-1-eu-west-1.pooler.supabase.com:5432/postgres"
    url = make_url(role_url(owner, "role-pw", "abcdefghijklmnopqrst"))
    assert url.username == f"{ROLE}.abcdefghijklmnopqrst"
    assert url.password == "role-pw"  # noqa: S105
    assert url.host == "aws-1-eu-west-1.pooler.supabase.com"
    assert url.port == 6543  # transaction pooler, for serverless
    assert "sslmode" not in url.query  # the backend enforces verify-full itself
    assert "owner-pw" not in url.render_as_string(hide_password=False)


def test_the_chat_prototype_works_as_the_role(role_url_for_tests: str, db_engine: Engine) -> None:
    """At 0003 the role can retrieve, rate-limit and record safety events, nothing more."""
    sources = Path(__file__).resolve().parents[1] / "app" / "knowledge" / "sources"
    with Session(db_engine) as session, session.begin():  # ingestion runs as the owner
        ingest_directory(session, sources)
    settings = auth_settings(database_url=role_url_for_tests)
    client = TestClient(create_app(settings, fake_verifier(settings), chat_runtime=make_runtime()))
    consent = {"version": PLACEHOLDER_V1.version, "granted": True, "consent_type": "required"}
    assert client.post("/consents", headers=bearer(), json=consent).status_code == 201
    body = client.post(
        "/chat/messages",
        headers=bearer(),
        json={"message": "Can you explain a simple grounding exercise?", "history": []},
    ).json()
    assert body["status"] == "reply"
    support = client.post(
        "/chat/messages", headers=bearer(), json={"message": "I want to end my life", "history": []}
    ).json()
    assert support["status"] == "support"
    with db_engine.connect() as conn:
        assert conn.execute(text("select count(*) from app.chat_rate_events")).scalar() == 2
        outcomes = {r[0] for r in conn.execute(text("select final_status from app.safety_events"))}
    assert outcomes == {"reply", "support"}


def test_grants_only_keeps_the_password(role_url_for_tests: str, db_engine: Engine) -> None:
    with db_engine.connect() as conn:
        before = conn.execute(
            text("select rolpassword from pg_authid where rolname = :r"), {"r": ROLE}
        ).scalar()
    with db_engine.begin() as conn:
        conn.execute(text(f"REVOKE ALL ON app.knowledge_chunks FROM {ROLE}"))
        apply_role(conn, None)  # grants only
    with db_engine.connect() as conn:
        after = conn.execute(
            text("select rolpassword from pg_authid where rolname = :r"), {"r": ROLE}
        ).scalar()
    assert before == after
    engine = _as_role(role_url_for_tests)  # the old password still logs in
    try:
        with engine.connect() as conn:
            assert verify_role(conn)["table_privileges"]["knowledge_chunks"] == ["SELECT"]
    finally:
        engine.dispose()


def test_a_new_role_cannot_be_created_without_a_password() -> None:
    with pytest.raises(ValueError, match="needs a password"):
        role_sql(None, exists=False)


def test_altering_an_existing_role_never_mentions_superuser() -> None:
    """Supabase refuses ALTER ROLE ... NOSUPERUSER from a non-superuser (seen live)."""
    alter = role_sql(None, exists=True)[0]
    assert alter.startswith(f"ALTER ROLE {ROLE} WITH LOGIN NOINHERIT BYPASSRLS")
    assert "SUPERUSER" not in alter and "REPLICATION" not in alter
    create = role_sql("v", exists=False)[0]
    assert "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION" in create
