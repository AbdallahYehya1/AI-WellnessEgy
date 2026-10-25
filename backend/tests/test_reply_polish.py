"""Reply polish found in the production quality review (2026-10-25)."""

from __future__ import annotations

import json

from app.ai.provider.groq import COACHING_RULES, GroqProvider
from app.assistants.registry import BY_ID
from app.assistants.understanding import understand
from tests.test_assistants import curated  # noqa: F401 - fixture
from tests.test_context import ask, make


def _parsed(reply: str) -> str:
    body = {
        "choices": [
            {
                "message": {
                    "content": json.dumps({"reply": reply, "citations": ["P2"], "risk": "none"})
                }
            }
        ]
    }
    return GroqProvider._parse(body, {"P2": "chunk-2"}).text


def test_passage_ids_never_reach_the_reader() -> None:
    assert _parsed("Use the Income Tracker idea from P2 and P3.") == "Use the Income Tracker idea."
    assert _parsed("Try step 3 from P4: name the feeling.") == "Try step 3: name the feeling."
    assert _parsed("جرّب الخطوة 3 من P4: بعد التسمية") == "جرّب الخطوة 3: بعد التسمية"
    assert _parsed("Plan your week (P1, P2).") == "Plan your week."
    # Ordinary words that only look like ids are kept.
    assert _parsed("A P2P transfer app works.") == "A P2P transfer app works."


def test_the_model_is_told_the_audience_is_in_egypt() -> None:
    assert "Egypt" in COACHING_RULES and "Egyptian pounds" in COACHING_RULES
    assert "Never write passage ids" in COACHING_RULES


def test_asking_for_an_example_gets_an_example_not_more_steps(curated: None) -> None:  # noqa: F811
    for message, language in (("Can you give me a short example?", "en"), ("ممكن مثال؟", "ar")):
        u = understand(BY_ID["everyday"], message, has_history=True)
        assert u.outcome == "accept" and u.follow_up == "example" and u.language == language
    c, _, provider = make("structured")
    first = ask(c, "How do I write a polite complaint email to a company?", "everyday").json()
    history = [
        {"role": "user", "text": "How do I write a polite complaint email to a company?"},
        {
            "role": "assistant",
            "text": first["reply"]["text"],
            "signature": first["reply"]["signature"],
        },
    ]
    second = ask(c, "Can you give me a short example?", "everyday", history=history).json()
    assert second["status"] == "reply"
    assert (
        provider.calls[-1].message
        == "Please give one short, concrete example based on the previous answer."
    )
