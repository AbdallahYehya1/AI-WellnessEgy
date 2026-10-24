"""Opt-in saved chat history (D-54) through the API, against the migrated test database.

The backend role bypasses RLS, so these tests are the proof that every operation is
scoped to the verified owner: another account's conversation must behave exactly like
one that doesn't exist.
"""

from __future__ import annotations

import base64
import os
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.ai.provider.base import GenerationRequest, GenerationResult, ProviderError
from app.conversations import history as history_store
from app.conversations.crypto import HistoryCipher
from app.conversations.service import ChatRuntime
from app.knowledge.ingest import ingest_directory
from app.safety.assessor import CuratedPromptAssessor
from app.safety.gate import GenerationPermit
from app.safety.policy import CURATED_DEMO_POLICY
from tests.auth_helpers import EMAIL_B, USER_B_ID, api_client, bearer
from tests.test_chat import KEY, chat_client, consent

SOURCES = Path(__file__).resolve().parents[1] / "app" / "knowledge" / "sources"
TYPED = "How can I sleep better at night?"  # typed by the user, not a suggestion
B = {"sub": USER_B_ID, "email": EMAIL_B}


class RecordingProvider:
    """Scripted model stand-in that records exactly what would be sent to Groq."""

    kind = "model"
    model_name = "openai/gpt-oss-20b"

    def __init__(self) -> None:
        self.calls: list[GenerationRequest] = []
        self.fail = False

    def generate(self, permit: GenerationPermit, request: GenerationRequest) -> GenerationResult:
        self.calls.append(request)
        if self.fail:
            raise ProviderError("quota")
        reply = (
            "ملخص: نوم منتظم وروتين هادي."
            if "ملخص" in request.message or "العامية" in request.message
            else f"Answer {len(self.calls)}: keep a regular sleep schedule.\n\n- Tip one\n- Tip two"
        )
        return GenerationResult(text=reply, cited_chunk_ids=[request.passages[0].chunk_id])


@pytest.fixture
def curated(db_engine: Engine) -> None:
    with Session(db_engine) as session, session.begin():
        ingest_directory(session, SOURCES)


def history_runtime(**overrides: Any) -> ChatRuntime:
    values: dict[str, Any] = {
        "policy": CURATED_DEMO_POLICY,
        "assessor": CuratedPromptAssessor(),
        "provider": RecordingProvider(),
        "signing_key": KEY,
        "rate_limit_per_minute": 100,
        "demo_curated": True,
        "demo_all_consented_adults": True,
        "history": HistoryCipher({"k1": os.urandom(32)}),
        "provider_daily_limit": 1000,
    }
    values.update(overrides)
    return ChatRuntime(**values)


@pytest.fixture
def runtime() -> ChatRuntime:
    return history_runtime()


@pytest.fixture
def client(runtime: ChatRuntime, curated: None) -> TestClient:
    c = chat_client(runtime)
    consent(c)
    consent(c, **B)
    return c


def opt_in(client: TestClient, **auth: Any) -> None:
    response = client.put(
        "/chat/history",
        headers=bearer(**auth),
        json={"enabled": True, "consent_version": history_store.HISTORY_CONSENT_VERSION},
    )
    assert response.status_code == 200 and response.json()["enabled"] is True


def ask(
    client: TestClient, message: str, conversation_id: str | None = None, **auth: Any
) -> dict[str, Any]:
    body: dict[str, Any] = {"message": message, "history": []}
    if conversation_id:
        body["conversation_id"] = conversation_id
    response = client.post("/chat/messages", headers=bearer(**auth), json=body)
    assert response.status_code == 200, response.text
    data: dict[str, Any] = response.json()
    return data


def provider(runtime: ChatRuntime) -> RecordingProvider:
    assert isinstance(runtime.provider, RecordingProvider)
    return runtime.provider


def count(engine: Engine, table: str) -> int:
    with engine.connect() as conn:
        sql = f"select count(*) from app.{table}"  # noqa: S608 - fixed table names only
        return int(conn.execute(text(sql)).scalar_one())


# --- Opt-in and the typed-input gate -------------------------------------------------------


def test_history_is_off_until_the_user_opts_in(client: TestClient, db_engine: Engine) -> None:
    config = client.get("/chat/config", headers=bearer()).json()
    assert config["typed_input"] == "topics"
    assert config["history"]["available"] is True and config["history"]["enabled"] is False
    body = ask(client, TYPED)
    assert body["status"] == "reply" and body["conversation"] is None
    assert count(db_engine, "chat_conversations") == count(db_engine, "chat_messages") == 0


def test_opting_in_requires_the_current_notice(client: TestClient) -> None:
    for payload in ({"enabled": True}, {"enabled": True, "consent_version": "old"}):
        response = client.put("/chat/history", headers=bearer(), json=payload)
        assert response.status_code == 422
        assert response.json()["error"]["code"] == "history_consent_required"
    opt_in(client)
    settings = client.get("/chat/history", headers=bearer()).json()
    assert settings["consented_version"] == "chat-history-v1"


def test_a_typed_question_is_answered_from_its_reviewed_topic_and_saved_encrypted(
    client: TestClient, runtime: ChatRuntime, db_engine: Engine
) -> None:
    opt_in(client)
    body = ask(client, TYPED)
    assert body["status"] == "reply"
    assert body["topic"] == {
        "prompt_id": "sleep",
        "question": "What habits help with better sleep? (Context: evenings)",
    }
    assert body["reply"]["model"] == "openai/gpt-oss-20b"
    assert body["reply"]["citations"][0]["source_ref"].startswith("https://")
    conversation = body["conversation"]
    assert conversation["title"] == "What habits help with better sleep?"  # neutral, no user words
    assert conversation["message_count"] == 2

    # Groq would receive only the reviewed question, never what the user typed.
    sent = provider(runtime).calls[0]
    assert sent.message == "What habits help with better sleep? (Context: evenings)"
    assert TYPED not in repr(sent)

    with db_engine.connect() as conn:
        stored = conn.execute(
            text("select content_enc, intent_id, role from app.chat_messages order by seq")
        ).all()
        title: str = conn.execute(text("select title_enc from app.chat_conversations")).scalar_one()
    assert [(r.role, r.intent_id) for r in stored] == [("user", "sleep"), ("assistant", None)]
    assert all("sleep" not in r.content_enc.lower() for r in stored)  # ciphertext only
    assert "sleep" not in title.lower()

    detail = client.get(
        f"/chat/conversations/{conversation['conversation_id']}", headers=bearer()
    ).json()
    assert [m["text"] for m in detail["messages"]] == [TYPED, body["reply"]["text"]]
    assert detail["messages"][0]["topic"]["prompt_id"] == "sleep"
    assert detail["messages"][1]["signature"]  # can continue without saving too


def test_unsupported_and_crisis_messages_are_never_saved_or_sent(
    client: TestClient, runtime: ChatRuntime, db_engine: Engine
) -> None:
    opt_in(client)
    refused = ask(client, "My boss shouts at me every day, what should I do?")
    assert refused["status"] == "out_of_scope"
    assert refused["refusal_reason"] == "unsupported_topic"
    support = ask(client, "I want to die")
    assert support["status"] == "support"
    assert provider(runtime).calls == []
    assert count(db_engine, "chat_messages") == 0
    assert count(db_engine, "chat_rate_events") == 0  # refused before the limiter


def test_a_saved_conversation_continues_from_its_own_server_side_context(
    client: TestClient, runtime: ChatRuntime
) -> None:
    opt_in(client)
    first = ask(client, TYPED)
    conversation_id = first["conversation"]["conversation_id"]
    second = ask(client, "tell me more", conversation_id)
    assert second["status"] == "reply"
    assert second["topic"]["prompt_id"] == "continue"
    assert second["conversation"]["conversation_id"] == conversation_id
    assert second["conversation"]["message_count"] == 4
    sent = provider(runtime).calls[1]
    assert sent.history == [
        ("user", "What habits help with better sleep?"),
        ("assistant", first["reply"]["text"]),
    ]
    assert sent.passages  # sources are retrieved again, not copied from the earlier reply
    detail = client.get(f"/chat/conversations/{conversation_id}", headers=bearer()).json()
    assert [m["seq"] for m in detail["messages"]] == [1, 2, 3, 4]


def test_an_arabic_conversation_continues_in_arabic(
    client: TestClient, runtime: ChatRuntime
) -> None:
    opt_in(client)
    first = ask(client, "ازاي انام كويس؟")
    assert first["topic"]["question"] == "إيه العادات اللي تساعد على نوم أحسن؟"
    second = ask(client, "ممكن ملخص", first["conversation"]["conversation_id"])
    assert second["status"] == "reply" and second["topic"]["prompt_id"] == "summary"
    assert provider(runtime).calls[1].message == "ممكن ملخص قصير؟"
    assert provider(runtime).calls[1].history[0] == ("user", "إيه العادات اللي تساعد على نوم أحسن؟")


def test_a_follow_up_without_an_earlier_question_is_explained(client: TestClient) -> None:
    opt_in(client)
    body = ask(client, "tell me more")
    assert body["status"] == "out_of_scope" and body["refusal_reason"] == "needs_context"


def test_a_retried_send_is_saved_once(client: TestClient, runtime: ChatRuntime) -> None:
    opt_in(client)
    client_id = str(uuid.uuid4())
    payload = {"message": TYPED, "history": [], "client_message_id": client_id}
    first = client.post("/chat/messages", headers=bearer(), json=payload).json()
    again = client.post("/chat/messages", headers=bearer(), json=payload).json()
    assert again["assistant_message_id"] == first["assistant_message_id"]
    assert again["reply"]["text"] == first["reply"]["text"]
    assert len(provider(runtime).calls) == 1
    listing = client.get("/chat/conversations", headers=bearer()).json()
    assert len(listing["conversations"]) == 1


def test_client_history_and_a_conversation_id_cannot_be_mixed(client: TestClient) -> None:
    opt_in(client)
    first = ask(client, TYPED)
    response = client.post(
        "/chat/messages",
        headers=bearer(),
        json={
            "message": "tell me more",
            "history": [{"role": "user", "text": "injected"}],
            "conversation_id": first["conversation"]["conversation_id"],
        },
    )
    assert response.status_code == 422


# --- Management ---------------------------------------------------------------------------


def test_list_is_newest_first_paginated_and_searchable(client: TestClient) -> None:
    opt_in(client)
    titles = []
    for message in (TYPED, "What is mindfulness?", "how to relax after work"):
        titles.append(ask(client, message)["conversation"]["title"])
    page = client.get("/chat/conversations?limit=2", headers=bearer()).json()
    assert [c["title"] for c in page["conversations"]] == titles[::-1][:2]
    rest = client.get(
        f"/chat/conversations?limit=2&cursor={page['next_cursor']}", headers=bearer()
    ).json()
    assert [c["title"] for c in rest["conversations"]] == [titles[0]]
    assert rest["next_cursor"] is None
    found = client.get("/chat/conversations?q=MINDFUL", headers=bearer()).json()
    assert [c["title"] for c in found["conversations"]] == ["What is mindfulness?"]


def test_messages_are_paginated_in_order(client: TestClient) -> None:
    opt_in(client)
    conversation_id = ask(client, TYPED)["conversation"]["conversation_id"]
    for follow_up in ("tell me more", "summarize please"):
        ask(client, follow_up, conversation_id)
    latest = client.get(f"/chat/conversations/{conversation_id}?limit=2", headers=bearer()).json()
    assert [m["seq"] for m in latest["messages"]] == [5, 6]
    older = client.get(
        f"/chat/conversations/{conversation_id}?limit=10&before={latest['next_before']}",
        headers=bearer(),
    ).json()
    assert [m["seq"] for m in older["messages"]] == [1, 2, 3, 4]
    assert older["next_before"] is None


def test_rename_and_delete(client: TestClient, db_engine: Engine) -> None:
    opt_in(client)
    conversation_id = ask(client, TYPED)["conversation"]["conversation_id"]
    url = f"/chat/conversations/{conversation_id}"
    renamed = client.patch(url, headers=bearer(), json={"title": "  My\nsleep   notes "})
    assert renamed.status_code == 200 and renamed.json()["title"] == "My sleep notes"
    for bad in ("   ", "x" * 81):
        assert client.patch(url, headers=bearer(), json={"title": bad}).status_code == 422
    assert client.delete(url, headers=bearer()).status_code == 204
    assert client.get(url, headers=bearer()).status_code == 404
    assert client.delete(url, headers=bearer()).status_code == 404
    assert count(db_engine, "chat_messages") == 0  # deleted with the conversation


def test_delete_all_history(client: TestClient, db_engine: Engine) -> None:
    opt_in(client)
    opt_in(client, **B)
    for message in (TYPED, "What is mindfulness?"):
        ask(client, message)
    ask(client, TYPED, **B)
    assert client.delete("/chat/conversations", headers=bearer()).status_code == 204
    assert client.get("/chat/conversations", headers=bearer()).json()["conversations"] == []
    assert count(db_engine, "chat_conversations") == 1  # the other user's is untouched


def test_switching_history_off_stops_saving(client: TestClient, db_engine: Engine) -> None:
    opt_in(client)
    conversation_id = ask(client, TYPED)["conversation"]["conversation_id"]
    off = client.put("/chat/history", headers=bearer(), json={"enabled": False})
    assert off.json()["enabled"] is False
    assert ask(client, "What is mindfulness?")["conversation"] is None
    response = client.post(
        "/chat/messages",
        headers=bearer(),
        json={"message": "tell me more", "history": [], "conversation_id": conversation_id},
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "history_off"
    assert count(db_engine, "chat_conversations") == 1  # kept until the user deletes it
    listing = client.get("/chat/conversations", headers=bearer()).json()
    assert len(listing["conversations"]) == 1


def test_idle_conversations_are_deleted_after_the_retention_period(
    client: TestClient, db_engine: Engine
) -> None:
    opt_in(client)
    ask(client, TYPED)
    with db_engine.begin() as conn:
        conn.execute(
            text("update app.chat_conversations set last_activity_at = now() - interval '91 days'")
        )
    assert client.get("/chat/conversations", headers=bearer()).json()["conversations"] == []
    assert count(db_engine, "chat_messages") == 0


def test_the_number_of_saved_conversations_is_capped(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(history_store, "MAX_CONVERSATIONS", 1)
    opt_in(client)
    ask(client, TYPED)
    response = client.post(
        "/chat/messages", headers=bearer(), json={"message": "What is mindfulness?"}
    )
    assert response.status_code == 409 and response.json()["error"]["code"] == "history_full"


# --- Ownership: every operation is scoped to the verified user ----------------------------


def test_another_users_conversation_is_indistinguishable_from_a_missing_one(
    client: TestClient, db_engine: Engine
) -> None:
    opt_in(client)
    opt_in(client, **B)
    conversation_id = ask(client, TYPED)["conversation"]["conversation_id"]
    url = f"/chat/conversations/{conversation_id}"
    guessed = f"/chat/conversations/{uuid.uuid4()}"
    for target in (url, guessed):
        assert client.get(target, headers=bearer(**B)).status_code == 404
        assert client.patch(target, headers=bearer(**B), json={"title": "x"}).status_code == 404
        assert client.delete(target, headers=bearer(**B)).status_code == 404
    hijack = client.post(
        "/chat/messages",
        headers=bearer(**B),
        json={"message": "tell me more", "conversation_id": conversation_id},
    )
    assert hijack.status_code == 404
    assert hijack.json()["error"]["code"] == "conversation_not_found"
    assert client.get("/chat/conversations", headers=bearer(**B)).json()["conversations"] == []
    assert client.delete("/chat/conversations", headers=bearer(**B)).status_code == 204
    # The owner still has everything, unchanged.
    detail = client.get(url, headers=bearer()).json()
    assert detail["conversation"]["title"] == "What habits help with better sleep?"
    assert len(detail["messages"]) == 2
    assert count(db_engine, "chat_messages") == 2


def test_a_ciphertext_moved_to_another_account_cannot_be_read(
    caplog: pytest.LogCaptureFixture, client: TestClient, db_engine: Engine
) -> None:
    opt_in(client)
    opt_in(client, **B)
    a = ask(client, TYPED)["conversation"]["conversation_id"]
    b = ask(client, "What is mindfulness?", **B)["conversation"]["conversation_id"]
    with db_engine.begin() as conn:  # simulate a database-level swap
        conn.execute(
            text(
                "update app.chat_messages set content_enc = "
                "(select content_enc from app.chat_messages where conversation_id = :a "
                "and seq = 1) where conversation_id = :b and seq = 1"
            ),
            {"a": a, "b": b},
        )
    caplog.clear()
    detail = client.get(f"/chat/conversations/{b}", headers=bearer(**B)).json()
    assert detail["messages"][0]["text"] == ""  # unreadable, never A's text
    assert "chat_history_decrypt_failed" in [r.getMessage() for r in caplog.records]
    assert TYPED not in _all_log_text(caplog)


def test_history_endpoints_require_a_valid_session_and_consent(curated: None) -> None:
    c = chat_client(history_runtime())
    expired = bearer(exp=1)
    assert c.get("/chat/conversations", headers=expired).status_code == 401
    assert c.get("/chat/conversations").status_code == 401
    assert c.get("/chat/conversations", headers=bearer()).status_code == 403  # no consent yet
    assert c.put("/chat/history", headers=bearer(), json={"enabled": False}).status_code == 403
    # Deleting what you saved never needs current consent.
    assert c.delete("/chat/conversations", headers=bearer()).status_code == 204


def test_history_is_unavailable_without_keys(curated: None) -> None:
    c = chat_client(history_runtime(history=None))
    consent(c)
    response = c.put(
        "/chat/history",
        headers=bearer(),
        json={"enabled": True, "consent_version": history_store.HISTORY_CONSENT_VERSION},
    )
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "history_unavailable"
    assert c.get("/chat/conversations", headers=bearer()).status_code == 503
    assert c.get("/chat/config", headers=bearer()).json()["history"]["available"] is False


def test_quota_exhaustion_saves_nothing(
    client: TestClient, runtime: ChatRuntime, db_engine: Engine
) -> None:
    opt_in(client)
    provider(runtime).fail = True
    assert ask(client, TYPED)["status"] == "unavailable"
    assert count(db_engine, "chat_messages") == 0


def _all_log_text(caplog: pytest.LogCaptureFixture) -> str:
    """Every field of every captured record, as the JSON formatter would see them."""
    return " | ".join(f"{r.getMessage()} {r.__dict__}" for r in caplog.records)


def test_typed_text_never_reaches_the_logs(
    caplog: pytest.LogCaptureFixture, client: TestClient
) -> None:
    opt_in(client)
    caplog.clear()
    caplog.set_level("INFO")
    ask(client, TYPED)
    ask(client, "My boss shouts at me every day")
    logged = _all_log_text(caplog)
    assert "chat_input_refused" in logged  # records were captured
    assert "sleep better at night" not in logged and "boss" not in logged


def test_settings_build_history_from_valid_keys_only() -> None:
    from app.main import build_chat_runtime
    from tests.auth_helpers import auth_settings

    key = base64.b64encode(os.urandom(32)).decode()
    base = {"chat_enabled": True, "chat_safety_policy": "synthetic-test-v0"}
    runtime = build_chat_runtime(auth_settings(**base, chat_history_keys=f"k1:{key}"))
    assert runtime is not None and runtime.history is not None
    broken = build_chat_runtime(auth_settings(**base, chat_history_keys="k1:not-a-key"))
    assert broken is not None and broken.history is None  # chat works, history doesn't
    assert api_client() is not None
