"""Read-only pre-migration check (docs/SUPABASE_MIGRATION_RUNBOOK.md §8.2).

    python -m app.ops.check_migration_target --target-only   # parse only, no connection
    python -m app.ops.check_migration_target                 # read-only inspection

Reads DATABASE_URL and SUPABASE_URL from the environment / backend/.env.

Before connecting it checks that DATABASE_URL is the Supabase *session pooler*
for the same project as SUPABASE_URL, and refuses to connect otherwise. It then
opens one transaction, sets it READ ONLY, confirms the server reports it as read
only, runs SELECTs only and rolls back. The password is never printed, and
connection errors are redacted. Row counts are reported, never row contents.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any
from urllib.parse import quote

from sqlalchemy import MetaData, Table, create_engine, func, select, text
from sqlalchemy.engine import Connection, Engine, make_url
from sqlalchemy.exc import ArgumentError, SQLAlchemyError

from app.core.config import Settings
from app.core.db import CONNECT_TIMEOUT_SECONDS, SCHEMA, sqlalchemy_url, tls_connect_args

EXPECTED_BY_REVISION: dict[str | None, list[str]] = {
    None: [],
    "0001": ["audit_events", "consents", "users"],
    "0002": ["audit_events", "consents", "mood_checkins", "users"],
    "0003": [
        "audit_events",
        "chat_rate_events",
        "consents",
        "knowledge_chunks",
        "knowledge_sources",
        "mood_checkins",
        "safety_events",
        "users",
    ],
}
EXPECTED_BY_REVISION["0004"] = EXPECTED_BY_REVISION["0003"]  # 0004 only adds columns
DATA_API_ROLES = ("anon", "authenticated")
POOLER_HOST_SUFFIX = ".pooler.supabase.com"
SESSION_POOLER_PORT = 5432
TRANSACTION_POOLER_PORT = 6543
_PROJECT_URL = re.compile(r"^https://([a-z0-9]{20})\.supabase\.co/?$")
_HOSTNAME = re.compile(r"^[A-Za-z0-9.-]+$")
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._-]+$")
UNPARSABLE = (
    "DATABASE_URL could not be parsed safely; URL-encode special characters "
    "(@ : / ? # %) in the password"
)


def _unparsable(supabase_url: str | None) -> dict[str, Any]:
    return {
        "host": None,
        "port": None,
        "database": None,
        "user": None,
        "connection_mode": "unparsable",
        "project_ref": None,
        "expected_project_ref": project_ref(supabase_url),
        "problems": [UNPARSABLE],
    }


def project_ref(supabase_url: str | None) -> str | None:
    match = _PROJECT_URL.match(supabase_url or "")
    return match.group(1) if match else None


def describe_target(database_url: str, supabase_url: str | None) -> dict[str, Any]:
    """Parse the target without connecting. ``problems`` empty means safe to connect."""
    try:
        url = make_url(sqlalchemy_url(database_url))
        host = url.host or ""
        user = url.username or ""
        port = url.port or SESSION_POOLER_PORT
    except (ArgumentError, ValueError):
        return _unparsable(supabase_url)
    # An unencoded "@" or "/" in the password shifts part of it into the host,
    # user or database. Print none of them unless all three look clean.
    if not (
        _HOSTNAME.match(host) and _IDENTIFIER.match(user) and _IDENTIFIER.match(url.database or "")
    ):
        return _unparsable(supabase_url)
    ref: str | None = None
    if host.endswith(POOLER_HOST_SUFFIX):
        mode = {
            SESSION_POOLER_PORT: "session_pooler",
            TRANSACTION_POOLER_PORT: "transaction_pooler",
        }
        connection_mode = mode.get(port, "pooler_unknown_port")
        ref = user.partition(".")[2] or None  # pooler users are postgres.<project-ref>
    elif host.startswith("db.") and host.endswith(".supabase.co"):
        connection_mode = "direct"
        ref = host.split(".")[1]
    else:
        connection_mode = "not_supabase"
    expected = project_ref(supabase_url)
    problems: list[str] = []
    if connection_mode != "session_pooler":
        problems.append(f"connection mode is {connection_mode}; expected session_pooler")
    if expected is None:
        problems.append("SUPABASE_URL is not set, so the project cannot be confirmed")
    elif ref != expected:
        problems.append("the project reference in DATABASE_URL does not match SUPABASE_URL")
    return {
        "host": host,
        "port": port,
        "database": url.database,
        "user": user,
        "connection_mode": connection_mode,
        "project_ref": ref,
        "expected_project_ref": expected,
        "problems": problems,
    }


def _names(conn: Connection, sql: str, **params: str) -> list[str]:
    return [row[0] for row in conn.execute(text(sql), params)]


def _flag(conn: Connection, sql: str, **params: str) -> bool:
    return bool(conn.execute(text(sql), params).scalar_one())


def inspect_target(engine: Engine) -> dict[str, Any]:
    url = engine.url
    report: dict[str, Any] = {
        "host": url.host,
        "port": url.port,
        "database": url.database,
        "user": url.username,
    }
    with engine.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            if (
                conn.execute(text("select current_setting('transaction_read_only')")).scalar_one()
                != "on"
            ):
                raise RuntimeError("the server did not confirm a read-only transaction")
            report.update(_inspect(conn))
        finally:
            transaction.rollback()
    return report


def _inspect(conn: Connection) -> dict[str, Any]:
    has_version = _flag(conn, "select to_regclass(:t) is not null", t=f"{SCHEMA}.alembic_version")
    revision = (
        conn.execute(text("select version_num from app.alembic_version")).scalar_one_or_none()
        if has_version
        else None
    )
    schema_exists = _flag(
        conn, "select exists (select 1 from pg_namespace where nspname = :s)", s=SCHEMA
    )
    tables = _names(
        conn,
        "select table_name from information_schema.tables "
        "where table_schema = :s and table_name <> 'alembic_version' order by 1",
        s=SCHEMA,
    )
    row_counts = {
        name: int(
            conn.execute(
                select(func.count()).select_from(Table(name, MetaData(), schema=SCHEMA))
            ).scalar_one()
        )
        for name in tables
    }
    rls_enabled = {
        row[0]: bool(row[1])
        for row in conn.execute(
            text(
                "select c.relname, c.relrowsecurity from pg_class c "
                "join pg_namespace n on n.oid = c.relnamespace "
                "where n.nspname = :s and c.relkind = 'r' and c.relname <> 'alembic_version' "
                "order by 1"
            ),
            {"s": SCHEMA},
        )
    }
    roles = _names(
        conn, "select rolname from pg_roles where rolname in ('anon', 'authenticated') order by 1"
    )
    role_schema_usage = (
        {
            row[0]: bool(row[1])
            for row in conn.execute(
                text(
                    "select rolname, has_schema_privilege(rolname, :s, 'USAGE') from pg_roles "
                    "where rolname in ('anon', 'authenticated') order by 1"
                ),
                {"s": SCHEMA},
            )
        }
        if schema_exists
        else {}
    )
    auth_users_count: int | None = None
    if _flag(conn, "select to_regclass('auth.users') is not null") and _flag(
        conn, "select has_table_privilege('auth.users', 'SELECT')"
    ):
        auth_users_count = int(conn.execute(text("select count(*) from auth.users")).scalar_one())
    expected = EXPECTED_BY_REVISION.get(revision)
    tables_match = expected is not None and sorted(tables) == sorted(expected)
    return {
        "read_only_transaction": True,
        "server_version": conn.execute(text("show server_version")).scalar_one(),
        "current_user": conn.execute(text("select current_user")).scalar_one(),
        "schemas": _names(
            conn,
            "select nspname from pg_namespace where nspname not like 'pg\\_%' "
            "and nspname <> 'information_schema' order by 1",
        ),
        "alembic_revision": revision,
        "public_alembic_version_exists": _flag(
            conn, "select to_regclass('public.alembic_version') is not null"
        ),
        "app_schema_exists": schema_exists,
        "app_tables": tables,
        "app_row_counts": row_counts,
        "tables_match_revision": tables_match,
        "rls_enabled": rls_enabled,
        "supabase_roles_present": roles,
        "data_api_roles_with_app_usage": [
            role for role, usage in role_schema_usage.items() if usage
        ],
        "auth_users_count": auth_users_count,
        "can_create_schema": _flag(
            conn, "select has_database_privilege(current_user, current_database(), 'CREATE')"
        ),
        "state": _state(revision, tables, tables_match, schema_exists),
    }


def _state(revision: str | None, tables: list[str], tables_match: bool, schema_exists: bool) -> str:
    if revision is None and not tables:
        return "fresh_empty_app_schema" if schema_exists else "fresh"
    return f"at_revision_{revision}" if tables_match else "inconsistent"


def redact(message: str, password: str | None) -> str:
    """First line of a driver error, with the password (raw or URL-encoded) removed."""
    line = message.strip().splitlines()[0] if message.strip() else ""
    if password:
        for variant in {password, quote(password, safe="")}:
            line = line.replace(variant, "***")
    return line


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.ops.check_migration_target")
    parser.add_argument(
        "--target-only", action="store_true", help="parse and verify the target, do not connect"
    )
    args = parser.parse_args(argv)
    settings = Settings()
    if settings.database_url is None:
        print(
            "DATABASE_URL is not set (put it in backend/.env; never paste it into chat)",
            file=sys.stderr,
        )
        return 2
    database_url = settings.database_url.get_secret_value()
    target = describe_target(database_url, settings.supabase_url)
    print(json.dumps({"target": target}, indent=2))
    if target["problems"]:
        print("Refusing to connect: " + "; ".join(target["problems"]), file=sys.stderr)
        return 3
    if args.target_only:
        return 0
    url = sqlalchemy_url(database_url)
    engine = create_engine(
        url,
        connect_args={
            "prepare_threshold": None,
            "connect_timeout": CONNECT_TIMEOUT_SECONDS,
            **tls_connect_args(url),
        },
    )
    try:
        report = inspect_target(engine)
    except (SQLAlchemyError, RuntimeError) as exc:
        cause = getattr(exc, "orig", None) or exc
        error = {
            "error": type(cause).__name__,
            "detail": redact(str(cause), make_url(url).password),
        }
        print(json.dumps(error, indent=2), file=sys.stderr)
        return 1
    finally:
        engine.dispose()
    print(json.dumps({"inspection": report}, indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(run())
