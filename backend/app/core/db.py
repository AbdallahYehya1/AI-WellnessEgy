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
from sqlalchemy import Engine, MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.common.errors import ApiError
from app.core.config import Settings

SCHEMA = "app"

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


def engine_for(database_url: str) -> Engine:
    """One engine (and connection pool) per database URL per process."""
    url = sqlalchemy_url(database_url)
    with _ENGINES_LOCK:
        engine = _ENGINES.get(url)
        if engine is None:
            engine = create_engine(
                url,
                pool_pre_ping=True,
                # Supabase's transaction pooler does not support prepared statements.
                connect_args={"prepare_threshold": None},
            )
            _ENGINES[url] = engine
        return engine


def session_factory_for(settings: Settings) -> sessionmaker[Session] | None:
    if settings.database_url is None:
        return None
    return sessionmaker(
        engine_for(settings.database_url.get_secret_value()), expire_on_commit=False
    )


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
