"""Generation gate: the only way to obtain permission to call a model.

A `GenerationPermit` can only be created here (a private key guards the
constructor), only for a decision whose outcome is GENERATE, and it is:
- bound to one request id and one message hash,
- short-lived,
- single-use (consumed before the provider is called).

`generate_with_permit` is the only function that calls a provider; it
consumes the permit first, so a missing, forged, expired, reused or
mismatched permit means the provider is never called.
"""

from __future__ import annotations

import hashlib
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Protocol

from app.safety.contracts import SafetyDecision

PERMIT_TTL_SECONDS = 30.0
_GATE_KEY = object()


class PermitError(Exception):
    """The permit is missing, forged, expired, reused or for another request."""


def message_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class GenerationPermit:
    permit_id: str
    request_id: str
    message_sha256: str
    expires_at: float
    _key: object = field(repr=False, compare=False)

    def __post_init__(self) -> None:
        if self._key is not _GATE_KEY:
            raise PermitError("permits can only be issued by the generation gate")


class GenerationGate:
    def __init__(self, ttl_seconds: float = PERMIT_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._issued: dict[str, bool] = {}  # permit_id -> already used
        self._lock = threading.Lock()

    def authorize(
        self, decision: SafetyDecision, request_id: str, message: str
    ) -> GenerationPermit | None:
        if not decision.generation_allowed:
            return None
        permit = GenerationPermit(
            permit_id=str(uuid.uuid4()),
            request_id=request_id,
            message_sha256=message_hash(message),
            expires_at=time.monotonic() + self._ttl,
            _key=_GATE_KEY,
        )
        with self._lock:
            self._issued[permit.permit_id] = False
        return permit

    def consume(self, permit: object, request_id: str, message: str) -> None:
        if not isinstance(permit, GenerationPermit) or permit._key is not _GATE_KEY:
            raise PermitError("missing or forged permit")
        with self._lock:
            used = self._issued.get(permit.permit_id)
            if used is None:
                raise PermitError("permit was not issued by this gate")
            if used:
                raise PermitError("permit already used")
            self._issued[permit.permit_id] = True
        if time.monotonic() > permit.expires_at:
            raise PermitError("permit expired")
        if permit.request_id != request_id or permit.message_sha256 != message_hash(message):
            raise PermitError("permit is for a different request")


class PermittedProvider[RequestT, ResultT](Protocol):
    def generate(self, permit: GenerationPermit, request: RequestT) -> ResultT: ...


def generate_with_permit[RequestT, ResultT](
    gate: GenerationGate,
    provider: PermittedProvider[RequestT, ResultT],
    permit: GenerationPermit | None,
    request_id: str,
    message: str,
    request: RequestT,
) -> ResultT:
    gate.consume(permit, request_id, message)
    if permit is None:  # unreachable: consume() rejects a missing permit
        raise PermitError("missing permit")
    return provider.generate(permit, request)
