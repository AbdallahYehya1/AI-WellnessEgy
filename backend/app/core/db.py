"""Database access: SQLAlchemy engine, declarative base and request sessions.

All application tables live in the dedicated ``app`` schema. On Supabase this
keeps them out of the auto-generated Data API, which only exposes ``public``
by default; the migrations also enable RLS and revoke Data API roles as a
second layer (docs/OPEN_DECISIONS.md, D-26).
"""

from __future__ import annotations

import threading
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, MetaData, create_engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.common.errors import ApiError
from app.core.config import Settings

SCHEMA = "app"
CONNECT_TIMEOUT_SECONDS = 3
POOL_SIZE = 5
POOL_MAX_OVERFLOW = 5
TLS_MODES = frozenset({"require", "verify-ca", "verify-full"})

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)


def sqlalchemy_url(database_url: str) -> str:
    """Use the psycopg 3 driver for plain ``postgresql://`` URLs."""
    for prefix in ("postgresql://", "postgres://"):
        if database_url.startswith(prefix):
            return "postgresql+psycopg://" + database_url.removeprefix(prefix)
    return database_url


_ENGINES: dict[str, Engine] = {}
_ENGINES_LOCK = threading.Lock()


def engine_for(database_url: str, *, require_tls: bool = False) -> Engine:
    """One engine (and connection pool) per database URL per process.

    ``require_tls`` (production) encrypts the connection unless the URL already asks
    for TLS, so a missing ``sslmode`` can't silently fall back to plaintext.
    """
    url = sqlalchemy_url(database_url)
    connect_args: dict[str, object] = {
        # Supabase's transaction pooler does not support prepared statements.
        "prepare_threshold": None,
        # Fail fast when the database is unreachable (well inside the
        # frontend's 5-second API timeout) instead of waiting on TCP.
        "connect_timeout": CONNECT_TIMEOUT_SECONDS,
    }
    if require_tls and make_url(url).query.get("sslmode") not in TLS_MODES:
        connect_args["sslmode"] = "require"
    with _ENGINES_LOCK:
        key = f"{url}#tls" if "sslmode" in connect_args else url
        engine = _ENGINES.get(key)
        if engine is None:
            engine = create_engine(
                url,
                pool_pre_ping=True,
                # Small and bounded: Supabase allows 60 connections and the backend
                # role is limited to 15. Waiting for a free connection gives up
                # quickly (503) instead of SQLAlchemy's default 30 seconds.
                pool_size=POOL_SIZE,
                max_overflow=POOL_MAX_OVERFLOW,
                pool_timeout=CONNECT_TIMEOUT_SECONDS,
                connect_args=connect_args,
            )
            _ENGINES[key] = engine
        return engine


def session_factory_for(settings: Settings) -> sessionmaker[Session] | None:
    if settings.database_url is None:
        return None
    engine = engine_for(
        settings.database_url.get_secret_value(), require_tls=settings.is_production
    )
    return sessionmaker(engine, expire_on_commit=False)


def get_db_session(request: Request) -> Iterator[Session]:
    """One transaction per request: committed on success, rolled back on error."""
    factory: sessionmaker[Session] | None = request.app.state.session_factory
    if factory is None:
        raise ApiError(
            503,
            "service_unavailable",
            "This service is temporarily unavailable. Please try again shortly.",
        )
    with factory() as session, session.begin():
        yield session


DbSession = Annotated[Session, Depends(get_db_session)]
