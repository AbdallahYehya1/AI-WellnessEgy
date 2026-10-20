"""Chat API schemas.

By default the conversation is held by the browser and nothing is persisted (D-37).
Users who explicitly opt in to saved history (D-54) send a ``conversation_id`` instead
of history; the server then loads the context itself and never trusts browser history.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_MESSAGE_CHARS = 2000
MAX_HISTORY_TURNS = 6
MAX_TITLE_CHARS = 80

# Why a typed message was not answered (shown to the user in plain language).
RefusalReason = Literal[
    "unsupported_topic",
    "multiple_topics",
    "needs_context",
    "too_long",
    "personal_or_unclear",
    "personal_details",
    "clinical",
    "sensitive",
]

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
    # Saved history (opt-in): continue this conversation; the server loads its context.
    conversation_id: UUID | None = None
    # Lets a retried send return the saved answer instead of saving it twice.
    client_message_id: UUID | None = None

    @field_validator("message")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("The message can't be empty.")
        return value

    @model_validator(mode="after")
    def _one_source_of_context(self) -> ChatRequest:
        if self.conversation_id is not None and self.history:
            raise ValueError("send either history or a conversation_id, not both")
        return self


class Citation(BaseModel):
    chunk_id: UUID
    source_title: str
    publisher: str
    source_ref: str
    version_label: str
    synthetic: bool
    # "approved" (clinically reviewed), "draft" (authentic publisher guidance, not
    # clinically reviewed for this app) or "synthetic" (test content).
    review_status: str = "approved"


class ChatReply(BaseModel):
    text: str
    signature: str
    citations: list[Citation]
    model: str | None = None


class TopicOut(BaseModel):
    """The reviewed question a typed message was recognised as, and answered."""

    prompt_id: str
    question: str


class ConversationSummary(BaseModel):
    conversation_id: UUID
    title: str
    message_count: int
    created_at: datetime
    last_activity_at: datetime


class ChatResponse(BaseModel):
    status: ChatStatus
    reply: ChatReply | None = None
    notice: str | None = None
    prototype: bool = True
    refusal_reason: RefusalReason | None = None
    topic: TopicOut | None = None
    # Set when the turn was saved (history opted in).
    conversation: ConversationSummary | None = None
    user_message_id: UUID | None = None
    assistant_message_id: UUID | None = None
    created_at: datetime | None = None


class StoredMessageOut(BaseModel):
    message_id: UUID
    seq: int
    role: Literal["user", "assistant"]
    text: str
    language: Literal["en", "ar"]
    topic: TopicOut | None = None
    citations: list[Citation]
    model: str | None = None
    # Assistant turns carry the server signature so the same thread can also be
    # continued without saving (for example after history is switched off).
    signature: str | None = None
    created_at: datetime


class ConversationPage(BaseModel):
    conversations: list[ConversationSummary]
    next_cursor: str | None = None


class ConversationDetail(BaseModel):
    conversation: ConversationSummary
    messages: list[StoredMessageOut]
    next_before: int | None = None


class RenameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=MAX_TITLE_CHARS)

    @field_validator("title")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not "".join(ch for ch in value if ch.isprintable()).strip():
            raise ValueError("The title can't be empty.")
        return value


class HistorySettings(BaseModel):
    available: bool  # the server can store history (configured and migrated)
    enabled: bool  # this user opted in
    consent_version: str
    consented_version: str | None = None
    retention_days: int
    max_conversations: int


class HistorySettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool
    # Required to opt in: the version of the storage notice the user agreed to.
    consent_version: str | None = Field(default=None, max_length=40)


class SupportedTopic(BaseModel):
    prompt_id: str
    en: str
    ar: str


class DemoPromptOut(BaseModel):
    prompt_id: str
    en: str
    ar: str
    follow_up: bool


class ChatConfig(BaseModel):
    enabled: bool
    age_band: str
    age_band_label: str
    test_only_policy: bool
    prototype: bool = True
    # "scripted": a test generator quotes retrieved passages (no AI model).
    # "model": an AI model writes the reply from retrieved passages.
    generator: Literal["scripted", "model"] | None = None
    model: str | None = None
    # Restricted demo: the only questions the server accepts (empty otherwise).
    demo_curated: bool = False
    demo_prompts: list[DemoPromptOut] = []
    # "topics": typed questions are accepted only when recognised as one of the
    # supported topics (D-53); "free": test-only free text (never in production).
    typed_input: Literal["topics", "free"] = "topics"
    supported_topics: list[SupportedTopic] = []
    history: HistorySettings | None = None
