"""Liveness endpoint.

Deliberately checks no dependencies and returns no configuration: the
response is exactly ``{"status": "ok"}`` (OPEN_DECISIONS D-15).
"""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["health"])


class HealthResponse(BaseModel):
    status: Literal["ok"]


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")
