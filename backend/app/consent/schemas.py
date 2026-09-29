"""Consent request/response schemas (docs/API_CONTRACT.md, Consents)."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.consent.catalog import ConsentType

ConsentStatus = Literal["missing", "granted", "declined", "outdated"]


class CurrentConsentResponse(BaseModel):
    version: str
    consent_type: ConsentType
    published_at: datetime
    summary_url: str
    pending_legal_review: bool


class ConsentCreate(BaseModel):
    """An explicit decision. `granted` must be a real JSON boolean: strings
    like "yes" or numbers are rejected rather than coerced."""

    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=64)
    granted: StrictBool
    consent_type: ConsentType


class ConsentRecordResponse(BaseModel):
    consent_id: UUID
    version: str
    granted: bool
    recorded_at: datetime


class ConsentStatusResponse(BaseModel):
    current_version: str
    status: ConsentStatus
    recorded_version: str | None
    recorded_at: datetime | None
