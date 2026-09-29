"""Privacy-safe structured (JSON-line) logging.

Rules:

- Never log message, journal or mood-note content, or any other free text
  written by a user.
- Never log secrets, tokens, credentials or request headers.
- Log request metadata only: method, path, status, duration, request id.

As a second line of defence, :class:`JsonFormatter` redacts any extra field
whose name looks sensitive, and any ``SecretStr`` value is rendered masked.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from typing import Any

from pydantic import SecretStr

REDACTED = "[REDACTED]"

_SENSITIVE_KEY = re.compile(
    r"secret|token|password|passwd|api[_-]?key|authorization|cookie|credential|"
    r"service[_-]?role|database[_-]?url|dsn",
    re.IGNORECASE,
)

_STANDARD_ATTRS = frozenset(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {
    "message",
    "asctime",
    "taskName",
}


def _is_sensitive_key(key: str) -> bool:
    return bool(_SENSITIVE_KEY.search(key))


def _safe_value(key: str, value: Any) -> Any:
    if _is_sensitive_key(key) or isinstance(value, SecretStr):
        return REDACTED
    if isinstance(value, dict):
        return {str(k): _safe_value(str(k), v) for k, v in value.items()}
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _STANDARD_ATTRS:
                payload[key] = _safe_value(key, value)
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """Configure the root logger once, at startup. Safe to call repeatedly."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())
    # Uvicorn's access log records full URLs, including query strings.
    # Request logging is done by our own middleware instead.
    logging.getLogger("uvicorn.access").disabled = True
    # HTTP client libraries log full request URLs (query strings included)
    # at INFO; keep only their warnings and errors.
    for name in ("httpx", "httpx2", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
