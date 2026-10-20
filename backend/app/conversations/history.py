"""Saved chat history: storage and retrieval, always scoped to the verified owner.

The backend connects with a role that bypasses RLS, so ownership is enforced HERE:
every query filters on the user id taken from the verified Supabase token (never on an
id sent by the browser), and a conversation that exists but belongs to someone else is
indistinguishable from one that doesn't exist.
"""

from __future__ import annotations

import base64
import binascii
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import delete, func, select, text, tuple_
from sqlalchemy.orm import Session

from app.conversations.crypto import HistoryCipher, HistoryDecryptError
from app.conversations.models import ChatConversation, ChatMessage
from app.core.logging import get_logger
from app.users.models import User

logger = get_logger(__name__)

HISTORY_CONSENT_VERSION = "chat-history-v1"
MAX_CONVERSATIONS = 200  # per user; older ones must be deleted before starting more
MAX_TITLE_CHARS = 80
CONTEXT_TURNS = 4  # recent turns sent back to the model, never the whole archive

TITLE = "title"
MESSAGE = "message"


@dataclass(frozen=True)
class StoredTurn:
    message_id: uuid.UUID
    seq: int
    role: str
    text: str
    intent_id: str | None
    language: str
    citations: list[dict[str, Any]]
    model: str | None
    created_at: datetime
    client_message_id: uuid.UUID | None


def clean_title(raw: str) -> str:
    """One line, no control characters, at most MAX_TITLE_CHARS."""
    title = "".join(ch if ch.isprintable() else " " for ch in raw)
    title = " ".join(title.split())
    return title[:MAX_TITLE_CHARS].rstrip()


def history_active(user: User, cipher: HistoryCipher | None) -> bool:
    return cipher is not None and user.chat_history_enabled


def set_history_enabled(session: Session, user: User, enabled: bool) -> None:
    user.chat_history_enabled = enabled
    if enabled:
        user.chat_history_consent_version = HISTORY_CONSENT_VERSION
        user.chat_history_consented_at = datetime.now(UTC)
    session.flush()


def purge_expired(session: Session, user_id: uuid.UUID, retention_days: int) -> int:
    """Delete this user's conversations idle for longer than the retention period."""
    cutoff = func.clock_timestamp() - text(f"interval '{int(retention_days)} days'")
    result = session.execute(
        delete(ChatConversation).where(
            ChatConversation.user_id == user_id, ChatConversation.last_activity_at < cutoff
        )
    )
    return _rowcount(result)


def _rowcount(result: object) -> int:
    return int(getattr(result, "rowcount", 0) or 0)


def _encode_cursor(at: datetime, row_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{at.isoformat()}|{row_id}".encode()).decode()


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID] | None:
    try:
        at, row_id = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(at), uuid.UUID(row_id)
    except (ValueError, binascii.Error, UnicodeDecodeError):
        return None


def _title(cipher: HistoryCipher, conversation: ChatConversation) -> str:
    try:
        return cipher.decrypt(
            conversation.title_enc,
            purpose=TITLE,
            row_id=conversation.id,
            owner_id=conversation.user_id,
        )
    except HistoryDecryptError:
        logger.error("chat_history_decrypt_failed", extra={"kind": TITLE})
        return ""


def list_conversations(
    session: Session,
    cipher: HistoryCipher,
    user_id: uuid.UUID,
    *,
    limit: int,
    cursor: str | None = None,
    query: str | None = None,
) -> tuple[list[tuple[ChatConversation, str]], str | None]:
    """Newest activity first. Titles are encrypted, so a title search decrypts this
    user's conversations (at most MAX_CONVERSATIONS) in the backend."""
    base = select(ChatConversation).where(ChatConversation.user_id == user_id)
    order = (ChatConversation.last_activity_at.desc(), ChatConversation.id.desc())
    if query:
        needle = query.casefold()
        rows = session.execute(base.order_by(*order).limit(MAX_CONVERSATIONS)).scalars().all()
        matches = [(c, t) for c in rows if needle in (t := _title(cipher, c)).casefold()]
        return matches[:limit], None
    position = decode_cursor(cursor) if cursor else None
    if position is not None:
        base = base.where(
            tuple_(ChatConversation.last_activity_at, ChatConversation.id) < tuple_(*position)
        )
    rows = session.execute(base.order_by(*order).limit(limit + 1)).scalars().all()
    page = list(rows[:limit])
    next_cursor = (
        _encode_cursor(page[-1].last_activity_at, page[-1].id) if len(rows) > limit else None
    )
    return [(c, _title(cipher, c)) for c in page], next_cursor


def get_conversation(
    session: Session, user_id: uuid.UUID, conversation_id: uuid.UUID, *, lock: bool = False
) -> ChatConversation | None:
    statement = select(ChatConversation).where(
        ChatConversation.id == conversation_id, ChatConversation.user_id == user_id
    )
    if lock:
        statement = statement.with_for_update()
    return session.execute(statement).scalar_one_or_none()


def conversation_title(cipher: HistoryCipher, conversation: ChatConversation) -> str:
    return _title(cipher, conversation)


def _turn(cipher: HistoryCipher, message: ChatMessage) -> StoredTurn:
    try:
        body = cipher.decrypt(
            message.content_enc, purpose=MESSAGE, row_id=message.id, owner_id=message.user_id
        )
    except HistoryDecryptError:
        logger.error("chat_history_decrypt_failed", extra={"kind": MESSAGE})
        body = ""
    return StoredTurn(
        message_id=message.id,
        seq=message.seq,
        role=message.role,
        text=body,
        intent_id=message.intent_id,
        language=message.language,
        citations=list(message.citations or []),
        model=message.model,
        created_at=message.created_at,
        client_message_id=message.client_message_id,
    )


def read_messages(
    session: Session,
    cipher: HistoryCipher,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    *,
    limit: int,
    before_seq: int | None = None,
) -> tuple[list[StoredTurn], int | None]:
    """A page of messages in order; ``next_before`` fetches the older page."""
    statement = select(ChatMessage).where(
        ChatMessage.conversation_id == conversation_id, ChatMessage.user_id == user_id
    )
    if before_seq is not None:
        statement = statement.where(ChatMessage.seq < before_seq)
    rows = session.execute(statement.order_by(ChatMessage.seq.desc()).limit(limit + 1)).scalars()
    found = list(rows)
    page = list(reversed(found[:limit]))
    next_before = page[0].seq if len(found) > limit and page else None
    return [_turn(cipher, m) for m in page], next_before


def recent_turns(
    session: Session, cipher: HistoryCipher, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> list[StoredTurn]:
    turns, _ = read_messages(session, cipher, user_id, conversation_id, limit=CONTEXT_TURNS * 2)
    return turns


def find_by_client_id(
    session: Session, cipher: HistoryCipher, user_id: uuid.UUID, client_message_id: uuid.UUID
) -> tuple[ChatConversation, StoredTurn, StoredTurn] | None:
    """A turn already saved for this client message id (a retried send)."""
    messages = (
        session.execute(
            select(ChatMessage)
            .where(
                ChatMessage.user_id == user_id,
                ChatMessage.client_message_id == client_message_id,
            )
            .order_by(ChatMessage.seq)
        )
        .scalars()
        .all()
    )
    if len(messages) != 2:
        return None
    conversation = get_conversation(session, user_id, messages[0].conversation_id)
    if conversation is None:
        return None
    return conversation, _turn(cipher, messages[0]), _turn(cipher, messages[1])


def count_conversations(session: Session, user_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count())
            .select_from(ChatConversation)
            .where(ChatConversation.user_id == user_id)
        ).scalar_one()
    )


def create_conversation(
    session: Session, cipher: HistoryCipher, user_id: uuid.UUID, title: str
) -> ChatConversation:
    conversation_id = uuid.uuid4()
    conversation = ChatConversation(
        id=conversation_id,
        user_id=user_id,
        title_enc=cipher.encrypt(
            clean_title(title) or "Conversation",
            purpose=TITLE,
            row_id=conversation_id,
            owner_id=user_id,
        ),
        message_count=0,
    )
    session.add(conversation)
    session.flush()
    return conversation


def append_turn(
    session: Session,
    cipher: HistoryCipher,
    conversation: ChatConversation,
    *,
    user_text: str,
    intent_id: str | None,
    user_language: str,
    reply_text: str,
    reply_language: str,
    citations: list[dict[str, Any]],
    model: str | None,
    client_message_id: uuid.UUID | None,
) -> tuple[StoredTurn, StoredTurn]:
    """Save one question and its reply. The caller holds the conversation row lock."""
    saved: list[ChatMessage] = []
    for offset, (role, body, intent, language, cites, model_name) in enumerate(
        (
            ("user", user_text, intent_id, user_language, [], None),
            ("assistant", reply_text, None, reply_language, citations, model),
        ),
        start=1,
    ):
        message_id = uuid.uuid4()
        message = ChatMessage(
            id=message_id,
            conversation_id=conversation.id,
            user_id=conversation.user_id,
            seq=conversation.message_count + offset,
            role=role,
            content_enc=cipher.encrypt(
                body, purpose=MESSAGE, row_id=message_id, owner_id=conversation.user_id
            ),
            intent_id=intent,
            language=language,
            citations=cites,
            model=model_name,
            client_message_id=client_message_id,
        )
        session.add(message)
        saved.append(message)
    conversation.message_count += 2
    conversation.updated_at = func.clock_timestamp()
    conversation.last_activity_at = func.clock_timestamp()
    session.flush()
    session.refresh(conversation)
    for message in saved:
        session.refresh(message)
    return _turn(cipher, saved[0]), _turn(cipher, saved[1])


def rename_conversation(
    session: Session,
    cipher: HistoryCipher,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    title: str,
) -> ChatConversation | None:
    conversation = get_conversation(session, user_id, conversation_id, lock=True)
    if conversation is None:
        return None
    conversation.title_enc = cipher.encrypt(
        clean_title(title), purpose=TITLE, row_id=conversation.id, owner_id=user_id
    )
    conversation.updated_at = func.clock_timestamp()
    session.flush()
    session.refresh(conversation)
    return conversation


def delete_conversation(session: Session, user_id: uuid.UUID, conversation_id: uuid.UUID) -> bool:
    result = session.execute(
        delete(ChatConversation).where(
            ChatConversation.id == conversation_id, ChatConversation.user_id == user_id
        )
    )
    return _rowcount(result) > 0


def delete_all_conversations(session: Session, user_id: uuid.UUID) -> int:
    result = session.execute(delete(ChatConversation).where(ChatConversation.user_id == user_id))
    return _rowcount(result)
