"""Chat API schemas. The conversation is held by the browser; nothing here is
persisted server-side (OPEN_DECISIONS D-37)."""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_TURNS = 6

ChatStatus = Literal[
    "reply", "support", "out_of_scope", "no_evidence", "unable_to_answer", "unavailable"
]


class HistoryTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    text: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    signature: str | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def _assistant_turns_are_signed(self) -> HistoryTurn:
        if self.role == "assistant" and not self.signature:
            raise ValueError("assistant turns must carry the server signature")
        return self


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    message: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)
    history: list[HistoryTurn] = Field(default_factory=list, max_length=MAX_HISTORY_TURNS)

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("The message can't be empty.")
        return value


class Citation(BaseModel):
    chunk_id: UUID
    source_title: str
    publisher: str
    source_ref: str
    version_label: str
    synthetic: bool


class ChatReply(BaseModel):
    text: str
    signature: str
    citations: list[Citation]


class ChatResponse(BaseModel):
    status: ChatStatus
    reply: ChatReply | None = None
    notice: str | None = None
    prototype: bool = True


class ChatConfig(BaseModel):
    enabled: bool
    age_band: str
    age_band_label: str
    test_only_policy: bool
    prototype: bool = True
