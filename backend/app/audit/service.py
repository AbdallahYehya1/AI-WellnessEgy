"""Audit log writer.

Audit rows record *that* something happened, *to what*, and *by whom*, never
the content. Metadata is restricted to identifier-like values, so free text
(names, messages, tokens) cannot be written here by accident.
"""

from __future__ import annotations

import re
import uuid
from typing import Literal

from sqlalchemy.orm import Session

from app.audit.models import AuditEvent

AuditAction = Literal[
    "user.created",
    "user.profile_updated",
    "consent.recorded",
]
TargetType = Literal["user", "consent"]
MetadataValue = str | int | bool | uuid.UUID | list[str]

# Short machine tokens only: versions, enum values, field names.
_TOKEN = re.compile(r"^[A-Za-z0-9_.:-]{1,64}$")
_MAX_METADATA_KEYS = 10


class AuditMetadataError(ValueError):
    """Raised when metadata would store something other than reference values."""


def _check_value(key: str, value: MetadataValue) -> str | int | bool | list[str]:
    if isinstance(value, bool | int):
        return value
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, str) and _TOKEN.match(value):
        return value
    if isinstance(value, list) and all(isinstance(v, str) and _TOKEN.match(v) for v in value):
        return list(value)
    raise AuditMetadataError(f"audit metadata value for {key!r} is not a reference token")


def record_event(
    session: Session,
    *,
    action: AuditAction,
    actor_user_id: uuid.UUID | None,
    target_type: TargetType,
    target_id: uuid.UUID | None,
    metadata: dict[str, MetadataValue] | None = None,
) -> AuditEvent:
    """Add an audit event to the current transaction (committed with the change)."""
    metadata = metadata or {}
    if len(metadata) > _MAX_METADATA_KEYS:
        raise AuditMetadataError("too many audit metadata keys")
    clean: dict[str, str | int | bool | list[str]] = {}
    for key, value in metadata.items():
        if not _TOKEN.match(key):
            raise AuditMetadataError("audit metadata keys must be reference tokens")
        clean[key] = _check_value(key, value)

    event = AuditEvent(
        id=uuid.uuid4(),
        actor_user_id=actor_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        metadata_=clean,
    )
    session.add(event)
    return event
