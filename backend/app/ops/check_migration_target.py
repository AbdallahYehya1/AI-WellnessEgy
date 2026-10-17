"""Read-only pre-migration check (docs/SUPABASE_MIGRATION_RUNBOOK.md §8.2).

    python -m app.ops.check_migration_target

Reads DATABASE_URL from the environment / backend/.env, opens a READ ONLY
transaction and prints: the target host, port, database and user (never the
password), the current Alembic revision, the tables in schema `app`, whether
Supabase's `anon` and `authenticated` roles exist, and whether the connecting
role can create schemas. It never writes anything.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import Settings
from app.core.db import CONNECT_TIMEOUT_SECONDS, SCHEMA, sqlalchemy_url

EXPECTED_BY_REVISION = {
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


def inspect_target(engine: Engine) -> dict[str, Any]:
    url = engine.url
    report: dict[str, Any] = {
        "host": url.host,
        "port": url.port,
        "database": url.database,
        "user": url.username,
    }
    with engine.connect() as conn, conn.begin():
        conn.execute(text("SET TRANSACTION READ ONLY"))
        has_version: bool = conn.execute(
            text("select to_regclass(:t) is not null"), {"t": f"{SCHEMA}.alembic_version"}
        ).scalar_one()
        revision = (
            conn.execute(text("select version_num from app.alembic_version")).scalar_one_or_none()
            if has_version
            else None
        )
        tables = [
            row[0]
            for row in conn.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_schema = :s and table_name <> 'alembic_version' order by 1"
                ),
                {"s": SCHEMA},
            )
        ]
        roles = [
            row[0]
            for row in conn.execute(
                text(
                    "select rolname from pg_roles "
                    "where rolname in ('anon', 'authenticated') order by 1"
                )
            )
        ]
        can_create: bool = conn.execute(
            text("select has_database_privilege(current_user, current_database(), 'CREATE')")
        ).scalar_one()
        schema_exists: bool = conn.execute(
            text("select exists (select 1 from pg_namespace where nspname = :s)"), {"s": SCHEMA}
        ).scalar_one()
    expected = EXPECTED_BY_REVISION.get(revision)
    report.update(
        {
            "alembic_revision": revision,
            "app_schema_exists": schema_exists,
            "app_tables": tables,
            "tables_match_revision": expected is not None and sorted(tables) == sorted(expected),
            "supabase_roles_present": roles,
            "can_create_schema": can_create,
        }
    )
    return report


def main() -> None:  # pragma: no cover - thin CLI wrapper
    settings = Settings()
    if settings.database_url is None:
        sys.exit("DATABASE_URL is not set (put it in backend/.env; never paste it into chat)")
    url = sqlalchemy_url(settings.database_url.get_secret_value())
    engine = create_engine(
        url, connect_args={"prepare_threshold": None, "connect_timeout": CONNECT_TIMEOUT_SECONDS}
    )
    try:
        print(json.dumps(inspect_target(engine), indent=2))
    finally:
        engine.dispose()


if __name__ == "__main__":  # pragma: no cover
    main()
