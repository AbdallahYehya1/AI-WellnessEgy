"""Provider context (D-59): what the model provider may receive about a situation."""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from app.ai.provider.base import GenerationRequest, GenerationResult
from app.assistants.context import CONTEXT_CONSENT_VERSION, redact
from app.conversations.service import ChatRuntime
from app.safety.gate import GenerationPermit
from tests.auth_helpers import bearer
from tests.test_assistants import B, curated, opt_in, runtime  # noqa: F401 - fixture
from tests.test_chat import chat_client, consent

WORK_LATE = (
    "My wife Sara feels neglected because I work late every night. I'm trying to earn more "
    "money for our future, but she thinks work matters more to me than she does. "
    "What should I do?"
)


class SituationProvider:
    """Records requests; cites the first passage when there is one."""

    kind = "model"
    model_name = "openai/gpt-oss-20b"

    def __init__(self, risk: str = "none", tokens: int | None = 900) -> None:
        self.calls: list[GenerationRequest] = []
        self.risk = risk
        self.tokens = tokens

    def generate(self, permit: GenerationPermit, request: GenerationRequest) -> GenerationResult:
        self.calls.append(request)
        cited = [request.passages[0].chunk_id] if request.passages else []
        return GenerationResult(
            text=f"Reply {len(self.calls)}: plan a calm talk about evenings and weekends.",
            cited_chunk_ids=cited,
            risk=self.risk,
            total_tokens=self.tokens,
        )


def make(
    mode: str = "minimized", **overrides: Any
) -> tuple[TestClient, ChatRuntime, SituationProvider]:
    provider = overrides.pop("provider", SituationProvider())
    rt = runtime(provider=provider, context_mode=mode, **overrides)
    c = chat_client(rt)
    consent(c)
    consent(c, **B)
    return c, rt, provider


def share(c: TestClient, enabled: bool = True, **auth: Any) -> Any:
    body: dict[str, Any] = {"enabled": enabled}
    if enabled:
        body["consent_version"] = CONTEXT_CONSENT_VERSION
    return c.put("/chat/context", headers=bearer(**auth), json=body)


def ask(c: TestClient, message: str, assistant: str = "relationships", **extra: Any) -> Any:
    return c.post(
        "/chat/messages",
        headers=bearer(),
        json={"message": message, "assistant_id": assistant, **extra},
    )


# --- Redaction --------------------------------------------------------------------------


def test_identifiers_are_removed_and_meaning_kept() -> None:
    r = redact(
        "My wife Sara and I argue. Call me on 0101 234 5678 or +20 10 1234 5678, mail "
        "sara.k@example.com, see https://x.example/p or @sara_k. "
        "We have 3 kids and I work 10 hours."
    )
    assert "Sara" not in r.text and "sara" not in r.text.lower().replace("[name]", "")
    for gone in ("0101", "1234", "example.com", "https://", "@sara_k"):
        assert gone not in r.text
    assert "my wife [name]" in r.text.lower()
    assert "3 kids" in r.text and "10 hours" in r.text  # short numbers carry meaning
    assert r.removed["number"] == 2 and r.removed["name"] == 1


def test_arabic_names_and_digits_are_removed() -> None:
    r = redact("مراتي اسمها سارة وبتتصل بيا على ٠١٠١٢٣٤٥٦٧٨ وساكنين في شارع التحرير")
    assert "سارة" not in r.text and "٠١٠١٢٣٤٥٦٧٨" not in r.text and "التحرير" not in r.text
    assert "[اسم]" in r.text and "[number]" in r.text


# --- Modes ------------------------------------------------------------------------------


def test_structured_is_the_default_even_after_consent(curated: None) -> None:  # noqa: F811
    c, _, provider = make("structured")
    assert share(c).status_code == 409  # nothing more is offered
    assert ask(c, WORK_LATE).json()["status"] == "reply"
    sent = provider.calls[-1].message
    assert "Sara" not in sent and "neglected" not in sent and "Assistant area" not in sent


def test_minimized_needs_the_users_own_consent(curated: None) -> None:  # noqa: F811
    c, _, provider = make("minimized")
    body = ask(c, WORK_LATE).json()
    assert body["provider_context"] is None
    assert "neglected" not in provider.calls[-1].message  # not opted in: structured

    config = c.get("/chat/config", headers=bearer()).json()["context"]
    assert config["available"] is True and config["enabled"] is False
    assert config["provider"] == "Groq" and config["processing_region"] == "United States"
    bad = c.put("/chat/context", headers=bearer(), json={"enabled": True, "consent_version": "old"})
    assert bad.status_code == 422
    assert share(c).json()["enabled"] is True

    body = ask(c, WORK_LATE).json()
    sent = provider.calls[-1].message
    assert body["status"] == "reply"
    # The situation keeps its meaning: who, what clashes, what they want...
    for kept in ("work late", "neglected", "money", "future"):
        assert kept in sent
    # ...without identifiers.
    assert "Sara" not in sent and "my wife [name]" in sent.lower()
    assert body["provider_context"] and "Sara" not in body["provider_context"]
    # Another account's consent is its own.
    other = c.get("/chat/config", headers=bearer(**B)).json()["context"]
    assert other["enabled"] is False


def test_follow_ups_continue_the_same_situation(curated: None) -> None:  # noqa: F811
    c, _, provider = make("minimized")
    share(c)
    first = ask(c, "My wife and I keep arguing about my working hours.").json()
    assert first["status"] == "reply"
    history = [
        {"role": "user", "text": "My wife and I keep arguing about my working hours."},
        {
            "role": "assistant",
            "text": first["reply"]["text"],
            "signature": first["reply"]["signature"],
        },
    ]
    second = ask(c, "She says I'm never available on weekends either.", history=history).json()
    assert second["status"] == "reply"
    request = provider.calls[-1]
    assert "weekends" in request.message
    assert any("working hours" in text_ for role, text_ in request.history if role == "user")


def test_withdrawing_consent_stops_earlier_words_reaching_the_provider(curated: None) -> None:  # noqa: F811
    c, _, provider = make("minimized")
    share(c)
    first = ask(c, WORK_LATE).json()
    share(c, enabled=False)
    history = [
        {"role": "user", "text": WORK_LATE},
        {
            "role": "assistant",
            "text": first["reply"]["text"],
            "signature": first["reply"]["signature"],
        },
    ]
    ask(c, "How do we talk about money without fighting?", history=history)
    request = provider.calls[-1]
    assert all("neglected" not in t for _, t in request.history)
    assert "Assistant area" not in request.message


def test_details_are_removed_instead_of_refused_for_opted_in_users(curated: None) -> None:  # noqa: F811
    c, _, provider = make("minimized")
    share(c)
    body = ask(
        c, "My husband and I argue about money, my number is 01012345678. How do we budget?"
    ).json()
    assert body["status"] == "reply"
    assert "01012345678" not in provider.calls[-1].message


def test_crisis_never_reaches_the_provider_in_any_mode(curated: None) -> None:  # noqa: F811
    c, _, provider = make("minimized")
    share(c)
    body = ask(c, "Some days I think everyone would be better off without me").json()
    assert body["status"] == "support" and body["support_kind"] == "crisis"
    assert "16328" in body["notice"]
    assert provider.calls == []


# --- Generation -------------------------------------------------------------------------


def test_coaching_without_matching_passages_is_labelled_general(curated: None) -> None:  # noqa: F811
    c, _, provider = make("minimized")
    share(c)
    body = ask(
        c, "My flatmate leaves dishes everywhere and I hate bringing it up", assistant="everyday"
    ).json()
    assert body["status"] == "reply"
    if not provider.calls[-1].passages:  # nothing matched: still answered, nothing cited
        assert body["reply"]["citations"] == []


def test_the_models_risk_reading_routes_to_support(curated: None) -> None:  # noqa: F811
    c, _, _ = make("minimized", provider=SituationProvider(risk="abuse"))
    share(c)
    opt_in(c)
    body = ask(c, "My partner checks where I am all day and I feel uneasy").json()
    assert body["status"] == "support" and body["support_kind"] == "relationship_safety"
    assert "15115" in body["notice"]
    assert c.get("/chat/conversations", headers=bearer()).json()["conversations"] == []


def test_the_shared_token_budget_is_enforced(curated: None, db_engine: Engine) -> None:  # noqa: F811
    c, _, provider = make("structured", daily_token_budget=1500)
    assert ask(c, WORK_LATE).json()["status"] == "reply"
    with Session(db_engine) as session:
        assert session.execute(text("select sum(tokens) from app.chat_rate_events")).scalar() == 900
    assert ask(c, "How can we spend more quality time together?").json()["status"] == "reply"
    body = ask(c, "How do we rebuild trust after an argument?").json()
    assert body["status"] == "unavailable" and body["refusal_reason"] == "shared_limit"
    assert len(provider.calls) == 2


def test_per_user_limit_is_configurable(curated: None) -> None:  # noqa: F811
    c, _, _ = make("structured", user_daily_limit=1)
    ask(c, WORK_LATE)
    ask(c, "How can we spend more quality time together?")
    body = ask(c, "How do we rebuild trust after an argument?").json()
    assert body["refusal_reason"] == "daily_limit"


@pytest.mark.parametrize("enabled", [True, False])
def test_context_choice_needs_a_signed_in_consented_user(curated: None, enabled: bool) -> None:  # noqa: F811
    c, _, _ = make("minimized")
    assert c.put("/chat/context", json={"enabled": enabled}).status_code == 401


def test_structured_follow_ups_continue_without_the_users_words(curated: None) -> None:  # noqa: F811
    c, _, provider = make("structured")
    first = ask(c, "My wife and I keep arguing about my working hours.").json()
    history = [
        {"role": "user", "text": "My wife and I keep arguing about my working hours."},
        {
            "role": "assistant",
            "text": first["reply"]["text"],
            "signature": first["reply"]["signature"],
        },
    ]
    second = ask(c, "And what if that does not work for us?", history=history).json()
    assert second["status"] == "reply"
    sent = provider.calls[-1].message
    assert "follow-up" in sent and "does not work for us" not in sent


class LongProvider(SituationProvider):
    def generate(self, permit: GenerationPermit, request: GenerationRequest) -> GenerationResult:
        self.calls.append(request)
        return GenerationResult(
            text="A practical step to try. " * 120,
            cited_chunk_ids=[request.passages[0].chunk_id, "P9-not-retrieved"],
        )


def test_overlong_replies_are_trimmed_and_unknown_citations_dropped(curated: None) -> None:  # noqa: F811
    c, _, _ = make("structured", provider=LongProvider())
    body = ask(c, WORK_LATE).json()
    assert body["status"] == "reply"
    assert len(body["reply"]["text"]) <= 1600 and body["reply"]["text"].endswith("…")
    assert all(cit["chunk_id"] != "P9-not-retrieved" for cit in body["reply"]["citations"])
    assert len(body["reply"]["citations"]) == 1
