"""FastAPI application factory."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from sqlalchemy.orm import Session, sessionmaker

from app.auth.tokens import SupabaseTokenVerifier
from app.common.errors import register_error_handlers
from app.consent.catalog import DEFAULT_CATALOG, ConsentCatalog
from app.consent.router import router as consent_router
from app.core.config import Settings, get_settings
from app.core.db import session_factory_for
from app.core.health import router as health_router
from app.core.logging import configure_logging, get_logger
from app.mood.router import router as mood_router
from app.users.router import router as users_router

logger = get_logger(__name__)


def create_app(
    settings: Settings | None = None,
    token_verifier: SupabaseTokenVerifier | None = None,
    session_factory: sessionmaker[Session] | None = None,
    consent_catalog: ConsentCatalog | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        # Log identifiers only; never dump the settings object.
        logger.info(
            "application_startup",
            extra={
                "environment": settings.environment,
                "version": settings.app_version,
                "auth_configured": settings.supabase_url is not None,
                "database_configured": settings.database_url is not None,
            },
        )
        yield
        logger.info("application_shutdown")

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
        docs_url="/docs" if settings.docs_enabled else None,
        redoc_url="/redoc" if settings.docs_enabled else None,
        openapi_url="/openapi.json" if settings.docs_enabled else None,
    )

    @app.middleware("http")
    async def request_logging(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        # Metadata only: no headers, query strings or bodies (they can hold
        # tokens or user-written text).
        request_id = str(uuid.uuid4())
        started = time.perf_counter()
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "http_request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            },
        )
        return response

    app.state.token_verifier = token_verifier or SupabaseTokenVerifier(settings)
    app.state.session_factory = session_factory or session_factory_for(settings)
    app.state.consent_catalog = consent_catalog or DEFAULT_CATALOG
    app.dependency_overrides[get_settings] = lambda: settings
    register_error_handlers(app)
    app.include_router(health_router)
    app.include_router(users_router)
    app.include_router(consent_router)
    app.include_router(mood_router)
    return app


app = create_app()
