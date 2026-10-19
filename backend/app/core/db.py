"""Database access: SQLAlchemy engine, declarative base and request sessions.

All application tables live in the dedicated ``app`` schema. On Supabase this
keeps them out of the auto-generated Data API, which only exposes ``public``
by default; the migrations also enable RLS and revoke Data API roles as a
second layer (docs/OPEN_DECISIONS.md, D-26).
"""

from __future__ import annotations

import os
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy import Engine, MetaData, create_engine, make_url
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.common.errors import ApiError
from app.core.config import Settings

SCHEMA = "app"
CONNECT_TIMEOUT_SECONDS = 3
# Long-running server (Docker): small, bounded pool.
POOL_SIZE = 5
POOL_MAX_OVERFLOW = 5
# Serverless (Vercel Functions): each instance keeps at most a few connections to
# Supabase's transaction pooler, which multiplexes them (Supabase's guidance for
# serverless is about one connection per instance).
SERVERLESS_POOL_SIZE = 1
SERVERLESS_POOL_MAX_OVERFLOW = 2
# Supabase's public root CA (not a secret), used to verify the server's certificate
# and hostname: `sslmode=require` alone encrypts but does not stop a man in the middle.
# sha256 807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa, expires 2031-04-26.
SUPABASE_ROOT_CA = Path(__file__).resolve().parent / "certs" / "supabase-root-2021.crt"
SUPABASE_HOST_SUFFIXES = (".supabase.com", ".supabase.co")

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


def tls_connect_args(database_url: str, *, required: bool = False) -> dict[str, str]:
    """Certificate- and hostname-verified TLS for Supabase hosts, and whenever required.

    A URL may choose ``verify-ca`` or its own ``sslrootcert``; anything weaker
    (missing, ``disable``, ``prefer``, ``require``) becomes ``verify-full`` against
    Supabase's root CA. Other hosts are left alone unless ``required``.
    """
    url = make_url(sqlalchemy_url(database_url))
    if not (required or (url.host or "").endswith(SUPABASE_HOST_SUFFIXES)):
        return {}
    mode = url.query.get("sslmode")
    root = url.query.get("sslrootcert")
    return {
        "sslmode": "verify-ca" if mode == "verify-ca" else "verify-full",
        "sslrootcert": root if isinstance(root, str) and root else str(SUPABASE_ROOT_CA),
    }


def running_on_vercel() -> bool:
    return os.environ.get("VERCEL") == "1"


def engine_for(database_url: str, *, require_tls: bool = False, serverless: bool = False) -> Engine:
    """One engine (and connection pool) per database URL and profile per process.

    ``require_tls`` (production) verifies the server certificate and hostname, so a
    missing or weak ``sslmode`` can't fall back to plaintext or an unverified peer.
    """
    url = sqlalchemy_url(database_url)
    connect_args: dict[str, object] = {
        # Supabase's transaction pooler does not support prepared statements.
        "prepare_threshold": None,
        # Fail fast when the database is unreachable (well inside the
        # frontend's 5-second API timeout) instead of waiting on TCP.
        "connect_timeout": CONNECT_TIMEOUT_SECONDS,
        **tls_connect_args(url, required=require_tls),
    }
    key = f"{url}#tls={'sslmode' in connect_args}#serverless={serverless}"
    with _ENGINES_LOCK:
        engine = _ENGINES.get(key)
        if engine is None:
            engine = create_engine(
                url,
                pool_pre_ping=True,
                # Small and bounded. Waiting for a free connection gives up quickly
                # (503) instead of SQLAlchemy's default 30 seconds.
                pool_size=SERVERLESS_POOL_SIZE if serverless else POOL_SIZE,
                max_overflow=SERVERLESS_POOL_MAX_OVERFLOW if serverless else POOL_MAX_OVERFLOW,
                pool_timeout=CONNECT_TIMEOUT_SECONDS,
                connect_args=connect_args,
            )
            _ENGINES[key] = engine
        return engine


def session_factory_for(settings: Settings) -> sessionmaker[Session] | None:
    if settings.database_url is None:
        return None
    engine = engine_for(
        settings.database_url.get_secret_value(),
        require_tls=settings.is_deployed,
        serverless=running_on_vercel(),
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
