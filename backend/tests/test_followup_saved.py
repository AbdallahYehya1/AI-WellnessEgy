"""Structured follow-ups in a saved conversation (production retest, 2026-10-25)."""

from __future__ import annotations

from tests.test_assistants import curated, opt_in  # noqa: F401 - fixture
from tests.test_context import ask, make


def test_a_saved_conversation_follow_up_is_answered(curated: None) -> None:  # noqa: F811
    c, _, provider = make("structured")
    opt_in(c)
    first = ask(
        c, "I keep quitting new habits after a week. How do I make them stick?", "growth"
    ).json()
    assert first["status"] == "reply"
    cid = first["conversation"]["conversation_id"]
    second = ask(c, "What should I do when I miss a day?", "growth", conversation_id=cid).json()
    assert second["status"] == "reply", second
    assert "follow-up" in provider.calls[-1].message
