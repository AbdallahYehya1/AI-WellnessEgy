"""The authenticated identity derived from a verified Supabase access token."""

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AuthenticatedPrincipal(BaseModel):
    """Who is calling. Built only from verified token claims, never from
    request bodies, query parameters or custom headers."""

    model_config = ConfigDict(frozen=True)

    user_id: UUID
    email: str | None
    role: str
    session_id: UUID | None
    aal: str | None
