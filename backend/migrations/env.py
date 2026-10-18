"""Alembic environment. Online mode only: migrations run against a live database."""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

import app.audit.models
import app.common.ratelimit
import app.consent.models
import app.knowledge.models
import app.mood.models
import app.safety.models
import app.users.models  # noqa: F401  (register models on the metadata)
from app.core.config import Settings
from app.core.db import SCHEMA, Base, sqlalchemy_url, tls_connect_args

config = context.config
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _database_url() -> str:
    url = config.attributes.get("database_url")
    if isinstance(url, str) and url:
        return url
    configured = Settings().database_url
    if configured is None:
        raise RuntimeError("DATABASE_URL is not set; cannot run migrations.")
    return configured.get_secret_value()


def run_migrations_online() -> None:
    engine = create_engine(
        sqlalchemy_url(_database_url()),
        poolclass=pool.NullPool,
        # Supabase hosts: certificate- and hostname-verified TLS.
        connect_args={"prepare_threshold": None, **tls_connect_args(_database_url())},
    )
    with engine.connect() as connection:
        # The version table lives in the app schema, so it must exist first.
        connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {SCHEMA}"))
        connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=SCHEMA,
            include_schemas=True,
            include_name=lambda name, type_, _parent: type_ != "schema" or name == SCHEMA,
            compare_type=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Offline (SQL script) migrations are not supported.")
run_migrations_online()
