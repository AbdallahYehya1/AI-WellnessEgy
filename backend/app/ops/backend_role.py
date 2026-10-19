"""Least-privilege database role for the internet-facing backend (OPEN_DECISIONS D-46).

    python -m app.ops.backend_role --print-sql   # the exact SQL, password verifier redacted
    python -m app.ops.backend_role --apply       # create/update the role  [founder approval]
    python -m app.ops.backend_role --verify      # read-only privilege report, as the role

Migrations keep running as the schema owner (`postgres`, DATABASE_URL in backend/.env).
The backend on Render connects as `app_backend`, which:

- can use schema `app` only, with exactly the table privileges its queries need;
- has no DELETE, TRUNCATE or DDL anywhere, and no access to `auth`, `storage` or `public`;
- has BYPASSRLS. The `app` tables have RLS enabled with no policies, which denies every
  role that doesn't bypass it. RLS here guards against Supabase's Data API roles; the
  backend enforces ownership in code (tests/test_*_isolation). BYPASSRLS grants nothing
  by itself: table privileges still gate every access.

`--apply` connects with DATABASE_URL (the owner), requires revision 0002, generates a random
password, sends only its SCRAM-SHA-256 verifier (the plaintext never reaches the server or
its logs), and writes the role's session-pooler connection string to a file outside the
repository. Nothing secret is printed.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import secrets
import sys
from pathlib import Path
from typing import Any

from sqlalchemy import Connection, create_engine, text
from sqlalchemy.engine import make_url

from app.core.config import Settings
from app.core.db import CONNECT_TIMEOUT_SECONDS, SCHEMA, sqlalchemy_url, tls_connect_args
from app.ops.check_migration_target import TRANSACTION_POOLER_PORT, describe_target

ROLE = "app_backend"
CONNECTION_LIMIT = 15
# Least privilege per table, derived from the backend's queries (users: insert-or-get,
# SELECT ... FOR UPDATE, profile update; consents/mood: append and read; audit: append).
GRANTS_0002: dict[str, tuple[str, ...]] = {
    "users": ("SELECT", "INSERT", "UPDATE"),
    "consents": ("SELECT", "INSERT"),
    "mood_checkins": ("SELECT", "INSERT"),
    "audit_events": ("INSERT",),
}
# 0003 (chat prototype): read knowledge (ingestion runs as the owner, never as this
# role), append safety events, and the per-user limiter (count, insert, prune >1 day).
GRANTS_0003: dict[str, tuple[str, ...]] = {
    **GRANTS_0002,
    "knowledge_sources": ("SELECT",),
    "knowledge_chunks": ("SELECT",),
    "safety_events": ("INSERT",),
    "chat_rate_events": ("SELECT", "INSERT", "DELETE"),
}
# 0004 only adds columns to the knowledge tables: same grants as 0003.
GRANTS_BY_REVISION = {"0002": GRANTS_0002, "0003": GRANTS_0003, "0004": GRANTS_0003}
GRANTS = GRANTS_0002
SUPPORTED_REVISION = "0002"
# Columns the ORM reads back (RETURNING) after an append, where it needs no full SELECT.
RETURNING_COLUMNS: dict[str, tuple[str, ...]] = {
    "audit_events": ("id", "created_at"),
    "safety_events": ("id", "created_at"),
}
AUDIT_RETURNING_COLUMNS = RETURNING_COLUMNS["audit_events"]
# Sequences behind integer keys the role inserts (0003: chat_rate_events.id).
SEQUENCES_BY_REVISION: dict[str, tuple[str, ...]] = {
    "0002": (),
    "0003": ("chat_rate_events_id_seq",),
    "0004": ("chat_rate_events_id_seq",),
}
ROLE_SETTINGS = {
    "statement_timeout": "5s",
    "lock_timeout": "3s",
    "idle_in_transaction_session_timeout": "15s",
}
DEFAULT_OUTPUT = Path.home() / "aiwe-secrets" / "backend_database_url"
PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE")


def scram_verifier(password: str, *, iterations: int = 4096, salt: bytes | None = None) -> str:
    """The SCRAM-SHA-256 verifier PostgreSQL stores (RFC 5802/7677), computed client-side."""
    salt = salt if salt is not None else secrets.token_bytes(16)
    salted = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()

    def b64(raw: bytes) -> str:
        return base64.b64encode(raw).decode()

    return f"SCRAM-SHA-256${iterations}:{b64(salt)}${b64(stored_key)}:{b64(server_key)}"


def _literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def role_sql(
    verifier: str | None, *, exists: bool, revision: str = SUPPORTED_REVISION
) -> list[str]:
    """Idempotent statements that leave the role with exactly the revision's grants.
    ``verifier=None`` keeps the existing password (the role must exist)."""
    if verifier is None and not exists:
        raise ValueError("a new role needs a password")
    grants = GRANTS_BY_REVISION[revision]
    password = f" PASSWORD {_literal(verifier)}" if verifier is not None else ""
    # CREATE states every attribute explicitly. ALTER on Supabase may not mention
    # SUPERUSER at all, even NOSUPERUSER (InsufficientPrivilege), so it only re-asserts
    # what can change; the NO* defaults set at creation are checked by --verify.
    restrictive = "" if exists else "NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION "
    attributes = (
        f"LOGIN NOINHERIT {restrictive}BYPASSRLS CONNECTION LIMIT {CONNECTION_LIMIT}{password}"
    )
    statements = [f"{'ALTER' if exists else 'CREATE'} ROLE {ROLE} WITH {attributes}"]
    statements += [
        f"ALTER ROLE {ROLE} SET {name} = {_literal(value)}" for name, value in ROLE_SETTINGS.items()
    ]
    statements += [
        f"REVOKE ALL ON ALL TABLES IN SCHEMA {SCHEMA} FROM {ROLE}",
        f"REVOKE ALL ON ALL SEQUENCES IN SCHEMA {SCHEMA} FROM {ROLE}",
        f"REVOKE ALL ON SCHEMA {SCHEMA} FROM {ROLE}",
        f"GRANT USAGE ON SCHEMA {SCHEMA} TO {ROLE}",
    ]
    statements += [
        f"GRANT {', '.join(privs)} ON {SCHEMA}.{table} TO {ROLE}" for table, privs in grants.items()
    ]
    statements += [
        f"GRANT SELECT ({', '.join(cols)}) ON {SCHEMA}.{table} TO {ROLE}"
        for table, cols in RETURNING_COLUMNS.items()
        if table in grants
    ]
    statements += [
        f"GRANT USAGE ON SEQUENCE {SCHEMA}.{seq} TO {ROLE}"
        for seq in SEQUENCES_BY_REVISION[revision]
    ]
    return statements


def redacted_sql(revision: str = SUPPORTED_REVISION) -> list[str]:
    return [
        s.replace(_literal("<verifier>"), "'<SCRAM-SHA-256 verifier, computed locally>'")
        for s in role_sql("<verifier>", exists=False, revision=revision)
    ]


def apply_role(
    owner_conn: Connection, password: str | None, *, expected_revision: str | None = None
) -> str:
    """Create or update the role for the database's revision, in one transaction (the
    caller commits). Refuses a revision without a reviewed grant set, or one other than
    ``expected_revision`` when given. Returns the revision applied."""
    found: object = owner_conn.execute(
        text("select version_num from app.alembic_version")
    ).scalar_one_or_none()
    revision = str(found)
    if found is None or revision not in GRANTS_BY_REVISION:
        raise RuntimeError(
            f"database is at revision {revision!r}; grants exist for {sorted(GRANTS_BY_REVISION)}"
        )
    if expected_revision is not None and revision != expected_revision:
        raise RuntimeError(f"database is at revision {revision!r}; expected {expected_revision}")
    exists = bool(
        owner_conn.execute(
            text("select count(*) from pg_roles where rolname = :r"), {"r": ROLE}
        ).scalar()
    )
    # Raw driver cursor, no parameters: nothing in the statements is parsed as a
    # placeholder. Errors name the statement and type only, never the SQL (which
    # carries the verifier).
    dbapi = owner_conn.connection.dbapi_connection
    if dbapi is None:
        raise RuntimeError("no database connection")
    cursor = dbapi.cursor()
    try:
        verifier = scram_verifier(password) if password is not None else None
        statements = role_sql(verifier, exists=exists, revision=revision)
        for index, statement in enumerate(statements):
            try:
                cursor.execute(statement)
            except Exception as exc:
                raise RuntimeError(f"role statement {index} failed: {type(exc).__name__}") from None
    finally:
        cursor.close()
    return revision


def role_url(owner_database_url: str, password: str, project_ref: str | None) -> str:
    """The role's connection string on the same host; pooler users are `<role>.<ref>`.

    For Supabase it targets the **transaction pooler** (port 6543), Supabase's
    recommendation for serverless functions. TLS is not in the URL: the backend
    always verifies Supabase's certificate and hostname (core.db.tls_connect_args).
    """
    url = make_url(sqlalchemy_url(owner_database_url))
    user = f"{ROLE}.{project_ref}" if project_ref else ROLE
    port = TRANSACTION_POOLER_PORT if project_ref else url.port
    rendered = url.set(drivername="postgresql", username=user, password=password, port=port)
    return rendered.render_as_string(hide_password=False)


def verify_role(conn: Connection) -> dict[str, Any]:
    """Read-only report of what the connected role can do. ``problems`` empty = as designed."""
    tx = conn.begin()
    try:
        conn.execute(text("SET TRANSACTION READ ONLY"))

        def scalar(sql: str, **params: str) -> Any:
            return conn.execute(text(sql), params).scalar()

        attrs = conn.execute(
            text(
                "select rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolconnlimit "
                "from pg_roles where rolname = current_user"
            )
        ).one()
        tables = [
            r[0]
            for r in conn.execute(
                text(
                    # pg_class, not information_schema: the latter hides tables
                    # the role has no privilege on, which are exactly the ones to report.
                    "select c.relname from pg_class c "
                    "join pg_namespace n on n.oid = c.relnamespace "
                    "where n.nspname = :s and c.relkind = 'r' order by 1"
                ),
                {"s": SCHEMA},
            )
        ]
        granted = {
            t: [
                p
                for p in PRIVILEGES
                if scalar(
                    "select has_table_privilege(current_user, :t, :p)", t=f"{SCHEMA}.{t}", p=p
                )
            ]
            for t in tables
        }
        schema_usage = {
            s: bool(
                scalar(
                    "select has_schema_privilege(current_user, n.oid, 'USAGE') "
                    "from pg_namespace n where nspname = :s",
                    s=s,
                )
            )
            for s in ("app", "auth", "storage", "public", "extensions", "vault")
            if scalar("select count(*) from pg_namespace where nspname = :s", s=s)
        }
        report: dict[str, Any] = {
            "current_user": scalar("select current_user"),
            "superuser": attrs[0],
            "createrole": attrs[1],
            "createdb": attrs[2],
            "bypassrls": attrs[3],
            "connection_limit": attrs[4],
            "settings": {
                name: scalar(f"select current_setting('{name}')") for name in ROLE_SETTINGS
            },
            "schema_usage": schema_usage,
            "can_create_in_app": bool(
                scalar("select has_schema_privilege(current_user, :s, 'CREATE')", s=SCHEMA)
            ),
            "can_create_in_public": bool(
                scalar("select has_schema_privilege(current_user, 'public', 'CREATE')")
            ),
            "table_privileges": granted,
            "reachable_tables_outside_app": [
                r[0]
                for r in conn.execute(
                    text(
                        "select n.nspname || '.' || c.relname from pg_class c "
                        "join pg_namespace n on n.oid = c.relnamespace "
                        "where c.relkind in ('r', 'v', 'm', 'p') and n.nspname not in "
                        "(:s, 'pg_catalog', 'information_schema') and n.nspname not like 'pg\\_%' "
                        "and has_schema_privilege(current_user, n.oid, 'USAGE') "
                        "and (has_table_privilege(current_user, c.oid, 'SELECT') "
                        "or has_table_privilege(current_user, c.oid, 'INSERT') "
                        "or has_table_privilege(current_user, c.oid, 'UPDATE') "
                        "or has_table_privilege(current_user, c.oid, 'DELETE')) order by 1"
                    ),
                    {"s": SCHEMA},
                )
            ],
        }
    finally:
        tx.rollback()
    # The catalog (readable by any role) tells which revision's tables exist.
    revision = "0003" if "chat_rate_events" in tables else "0002"
    grants = GRANTS_BY_REVISION[revision]
    report["grant_set"] = revision
    expected = {t: [p for p in PRIVILEGES if p in grants.get(t, ())] for t in tables}
    problems = [
        f"{key} should be {want!r}"
        for key, want, got in (
            ("superuser", False, report["superuser"]),
            ("createrole", False, report["createrole"]),
            ("createdb", False, report["createdb"]),
            ("bypassrls", True, report["bypassrls"]),
            ("can_create_in_app", False, report["can_create_in_app"]),
            ("can_create_in_public", False, report["can_create_in_public"]),
            ("table_privileges", expected, granted),
        )
        if got != want
    ]
    # Every role may use schema public through PUBLIC (Postgres and Supabase default);
    # what matters is that no table outside app is reachable.
    problems += [
        f"must not use schema {s}"
        for s, ok in schema_usage.items()
        if ok and s not in ("app", "public")
    ]
    problems += [f"must not reach table {t}" for t in report["reachable_tables_outside_app"]]
    if not schema_usage.get("app"):
        problems.append("must use schema app")
    report["problems"] = problems
    return report


def _engine(url: str) -> Any:
    return create_engine(
        sqlalchemy_url(url),
        connect_args={
            "prepare_threshold": None,
            "connect_timeout": CONNECT_TIMEOUT_SECONDS,
            **tls_connect_args(url),
        },
    )


def run(argv: list[str] | None = None) -> int:  # pragma: no cover - exercised manually
    parser = argparse.ArgumentParser(prog="python -m app.ops.backend_role")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--print-sql", action="store_true")
    mode.add_argument("--apply", action="store_true")
    mode.add_argument("--verify", action="store_true")
    mode.add_argument(
        "--grants-only",
        action="store_true",
        help="re-apply grants for the current revision, keeping the existing password",
    )
    parser.add_argument(
        "--output", type=Path, default=DEFAULT_OUTPUT, help="where --apply writes the role URL"
    )
    parser.add_argument(
        "--revision",
        choices=sorted(GRANTS_BY_REVISION),
        default=SUPPORTED_REVISION,
        help="grant set to print (--apply always uses the database's revision)",
    )
    args = parser.parse_args(argv)
    if args.print_sql:
        print(";\n".join(redacted_sql(args.revision)) + ";")
        return 0
    if args.verify:
        if not args.output.exists():
            print(f"{args.output} not found; run --apply first", file=sys.stderr)
            return 2
        engine = _engine(args.output.read_text(encoding="utf-8").strip())
        try:
            with engine.connect() as conn:
                report = verify_role(conn)
        finally:
            engine.dispose()
        print(json.dumps(report, indent=2))
        return 0 if not report["problems"] else 1
    settings = Settings()
    if settings.database_url is None:
        print("DATABASE_URL (the owner) is not set in backend/.env", file=sys.stderr)
        return 2
    owner_url = settings.database_url.get_secret_value()
    target = describe_target(owner_url, settings.supabase_url)
    print(json.dumps({"target": target}, indent=2))
    if target["problems"]:
        print("Refusing to apply: " + "; ".join(target["problems"]), file=sys.stderr)
        return 3
    password = None if args.grants_only else secrets.token_urlsafe(32)
    engine = _engine(owner_url)
    try:
        with engine.begin() as conn:
            revision = apply_role(conn, password)
    finally:
        engine.dispose()
    if password is None:  # no new credential: the deployed backend keeps working
        print(f"Grants for revision {revision} applied to {ROLE}; password unchanged.")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # No trailing newline: the whole file is pasted into a dashboard as the value.
    args.output.write_text(role_url(owner_url, password, target["project_ref"]), encoding="utf-8")
    args.output.chmod(0o600)
    print(f"Role {ROLE} applied. Its connection string is in {args.output} (not printed).")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(run())
