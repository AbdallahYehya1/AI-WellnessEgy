"""API error type and the shared error response shape.

Every handled error is returned as ``{"error": {"code": ..., "message": ...}}``
(docs/API_CONTRACT.md). Messages are written for end users and never contain
provider errors, tokens or other internal detail. Validation errors list the
offending fields but never echo the submitted values.
"""

from __future__ import annotations

from collections.abc import Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.exc import InterfaceError, OperationalError

from app.core.logging import get_logger

logger = get_logger(__name__)


class FieldError(BaseModel):
    field: str
    message: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    fields: list[FieldError] | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.headers = dict(headers or {})


def _error_json(
    status_code: int, detail: ErrorDetail, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=ErrorResponse(error=detail).model_dump(exclude_none=True),
        headers=dict(headers or {}),
    )


async def _handle_api_error(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, ApiError):  # registered for ApiError only
        raise exc
    return _error_json(
        exc.status_code, ErrorDetail(code=exc.code, message=exc.message), exc.headers
    )


def _field_message(error: Mapping[str, object]) -> str:
    message = str(error.get("msg", "Invalid value."))
    # Pydantic prefixes custom validator messages with "Value error, ".
    return message.removeprefix("Value error, ")


async def _handle_validation_error(_: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, RequestValidationError):
        raise exc
    fields = [
        FieldError(
            field=".".join(str(part) for part in error.get("loc", ()) if part != "body") or "body",
            message=_field_message(error),
        )
        for error in exc.errors()
    ]
    detail = ErrorDetail(
        code="validation_failed", message="Some of the submitted values are invalid.", fields=fields
    )
    return _error_json(422, detail)


async def _handle_database_unavailable(_: Request, exc: Exception) -> JSONResponse:
    """The database can't be reached (connection refused, timeout, pooler down).

    Clients get the standard 503 body. Only the exception class is logged: the
    message can contain the host, the SQL or parameter values.
    """
    if not isinstance(exc, (OperationalError, InterfaceError)):
        raise exc
    logger.error("database_unavailable", extra={"error_type": type(exc.orig or exc).__name__})
    return _error_json(
        503,
        ErrorDetail(
            code="service_unavailable",
            message="This service is temporarily unavailable. Please try again shortly.",
        ),
    )


def register_error_handlers(app: FastAPI) -> None:
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    # Connectivity failures only; integrity and programming errors stay 500s.
    app.add_exception_handler(OperationalError, _handle_database_unavailable)
    app.add_exception_handler(InterfaceError, _handle_database_unavailable)
