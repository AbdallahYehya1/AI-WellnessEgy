"""RAG prototype over the curated public-health sources (WHO, NIMH).

Engineering evidence only: retrieval, citation, safety routing and provider handling
behave as designed. The sources are authentic publisher guidance that has NOT been
clinically reviewed for this app (review_status draft), the safety policy is the
TEST-ONLY one, and nothing here establishes clinical safety.
"""

from __future__ import annotations

import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, ClassVar

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from sqlalchemy import Engine
from sqlalchemy.orm import Session

from app.ai.provider.base import GenerationRequest, Passage, ProviderError
from app.ai.provider.groq import USER_AGENT, GroqProvider
from app.core.config import Settings
from app.knowledge.ingest import IngestError, ingest_directory, parse
from app.main import build_chat_runtime
from app.safety.gate import GenerationGate
from tests.conftest import parse_log_lines
from tests.test_chat import chat_client, consent, make_runtime, send

SOURCES = Path(__file__).resolve().parents[1] / "app" / "knowledge" / "sources"
WHO_URL = "https://www.who.int/publications/i/item/9789240003927"
NIMH_HOST = "https://www.nimh.nih.gov/"


def _emotional_sources() -> tuple[set[str], set[str]]:
    """Publishers and URLs of the real sources tagged for Emotional Wellbeing."""
    publishers, refs = set(), set()
    for f in SOURCES.glob("*.md"):
        meta = dict(
            line.split(": ", 1)
            for line in f.read_text(encoding="utf-8").split("---")[1].strip().splitlines()
        )
        if "emotional" in meta["domains"]:
            publishers.add(meta["publisher"])
            refs.add(meta["source_ref"])
    return publishers, refs


EMOTIONAL_PUBLISHERS, EMOTIONAL_REFS = _emotional_sources()
SOURCE_COUNT = len(list(SOURCES.glob("*.md")))

DEMO_PROMPTS = [
    "I've been stressed about work. What general coping techniques might help?",
    "Can you explain a simple grounding exercise?",
    "What are some everyday habits that support wellbeing?",
]


@pytest.fixture
def curated(db_engine: Engine) -> None:
    with Session(db_engine) as session, session.begin():
        assert ingest_directory(session, SOURCES) == SOURCE_COUNT


@pytest.fixture
def demo(curated: None) -> TestClient:
    client = chat_client(make_runtime())
    consent(client)
    return client


@pytest.mark.parametrize("prompt", DEMO_PROMPTS)
def test_demo_prompts_get_cited_replies_from_real_sources(demo: TestClient, prompt: str) -> None:
    body = send(demo, prompt).json()
    assert body["status"] == "reply"
    citations = body["reply"]["citations"]
    assert citations
    for c in citations:
        assert c["review_status"] == "draft"  # authentic, not clinically reviewed
        assert c["synthetic"] is False
        assert c["source_ref"] in EMOTIONAL_REFS  # an ingested Emotional Wellbeing source
    # The scripted generator quotes the passage, not its heading.
    assert "(WHO, Doing What Matters" not in body["reply"]["text"]


def test_grounding_question_cites_who(demo: TestClient) -> None:
    body = send(demo, "Can you explain a simple grounding exercise?").json()
    assert body["reply"]["citations"][0]["publisher"] == "World Health Organization"
    assert "feet into the floor" in body["reply"]["text"]


def test_follow_up_in_egyptian_arabic_uses_the_arabic_who_edition(demo: TestClient) -> None:
    first = send(demo, "Can you explain a simple grounding exercise?").json()
    history = [
        {"role": "user", "text": "Can you explain a simple grounding exercise?"},
        {
            "role": "assistant",
            "text": first["reply"]["text"],
            "signature": first["reply"]["signature"],
        },
    ]
    body = send(demo, "Can you explain that in Egyptian Arabic?", history).json()
    assert body["status"] == "reply"
    assert body["reply"]["citations"][0]["version_label"] == "2020-ar"
    assert "الارتكاز" in body["reply"]["text"] or "ارتكز" in body["reply"]["text"]


def test_continuing_an_earlier_topic_keeps_its_sources(demo: TestClient) -> None:
    first_q = DEMO_PROMPTS[0]
    first = send(demo, first_q).json()
    history = [
        {"role": "user", "text": first_q},
        {
            "role": "assistant",
            "text": first["reply"]["text"],
            "signature": first["reply"]["signature"],
        },
    ]
    body = send(
        demo, "Can we continue discussing the earlier stress-management technique?", history
    ).json()
    assert body["status"] == "reply"
    assert {c["publisher"] for c in body["reply"]["citations"]} <= EMOTIONAL_PUBLISHERS


@pytest.mark.parametrize("prompt", ["What is the capital of France?", "Write a Python function"])
def test_off_topic_questions_find_no_evidence(demo: TestClient, prompt: str) -> None:
    assert send(demo, prompt).json()["status"] == "no_evidence"


@pytest.mark.parametrize(
    "prompt",
    [
        "Everything is too much, I want to end my life",
        "I keep thinking about suicide",
        "مش قادر، عايز اموت",
        "بفكر في الانتحار",
    ],
)
def test_crisis_language_is_routed_to_support_never_generation(curated: None, prompt: str) -> None:
    runtime = make_runtime()
    client = chat_client(runtime)
    consent(client)
    body = send(client, prompt).json()
    assert body["status"] == "support"
    assert body["reply"] is None
    assert runtime.provider.calls == []  # type: ignore[attr-defined]


def test_crisis_language_earlier_in_the_conversation_still_blocks(curated: None) -> None:
    runtime = make_runtime()
    client = chat_client(runtime)
    consent(client)
    history = [{"role": "user", "text": "I want to hurt myself"}]
    assert (
        send(client, "Can you explain a simple grounding exercise?", history).json()["status"]
        == "support"
    )


# --- Groq provider, against a local stand-in server (no network) -------------------


class FakeGroq(BaseHTTPRequestHandler):
    reply: ClassVar[dict[str, Any] | None] = None
    status: ClassVar[int] = 200
    requests: ClassVar[list[dict[str, Any]]] = []
    headers_seen: ClassVar[list[dict[str, str]]] = []

    def do_POST(self) -> None:
        length = int(self.headers["Content-Length"])
        FakeGroq.requests.append(json.loads(self.rfile.read(length)))
        FakeGroq.headers_seen.append(dict(self.headers))
        if self.headers.get("User-Agent", "").startswith("Python-urllib"):
            # Like Groq's real edge: Cloudflare error 1010 before the API (2026-10-20).
            self.send_response(403)
            self.send_header("Content-Length", "17")
            self.end_headers()
            self.wfile.write(b"error code: 1010\n")
            return
        body = json.dumps(
            {"choices": [{"message": {"content": json.dumps(FakeGroq.reply)}}]}
            if FakeGroq.status == 200
            else {"error": {"message": "echo of the request would go here"}}
        ).encode()
        self.send_response(FakeGroq.status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        return


@pytest.fixture
def groq_url() -> Iterator[str]:
    FakeGroq.reply, FakeGroq.status = None, 200
    FakeGroq.requests, FakeGroq.headers_seen = [], []
    server = HTTPServer(("127.0.0.1", 0), FakeGroq)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/openai/v1/chat/completions"
    server.shutdown()
    server.server_close()
    thread.join(timeout=5)


def _request(history: list[tuple[str, str]] | None = None) -> GenerationRequest:
    return GenerationRequest(
        message="Can you explain a simple grounding exercise?",
        history=history or [],
        passages=[Passage("chunk-a", "Grounding text."), Passage("chunk-b", "Other text.")],
        instructions="Adult band.",
        max_chars=600,
    )


def _permit(gate: GenerationGate) -> Any:
    from app.safety.contracts import Outcome, RiskLevel, SafetyDecision

    decision = SafetyDecision(RiskLevel.LOW, Outcome.GENERATE, "synthetic-test-v0", "synthetic_low")
    return gate.authorize(decision, "req-1", "msg")


def test_groq_reply_maps_passage_ids_to_chunk_ids(groq_url: str) -> None:
    FakeGroq.reply = {
        "reply": "Try grounding: slow down and notice your feet.",
        "citations": ["P1"],
    }
    provider = GroqProvider("test-key", "openai/gpt-oss-20b", url=groq_url)
    result = provider.generate(_permit(GenerationGate()), _request())
    assert result.cited_chunk_ids == ["chunk-a"]
    sent = FakeGroq.requests[0]
    assert sent["model"] == "openai/gpt-oss-20b"
    assert sent["max_completion_tokens"] == 1024
    assert sent["response_format"] == {"type": "json_object"}
    # gpt-oss is a reasoning model: little reasoning, and never returned to us.
    assert sent["reasoning_effort"] == "low" and sent["include_reasoning"] is False
    assert "[P1] Grounding text." in sent["messages"][1]["content"]
    assert "Arabic script" in sent["messages"][0]["content"]  # no mixed-script Arabic replies
    assert FakeGroq.headers_seen[0]["Authorization"] == "Bearer test-key"
    assert FakeGroq.headers_seen[0]["User-Agent"] == USER_AGENT  # not Python-urllib (edge 1010)
    assert FakeGroq.headers_seen[0]["Accept"] == "application/json"


def test_groq_request_carries_no_identity_and_bounded_history(groq_url: str) -> None:
    FakeGroq.reply = {"reply": "ok", "citations": ["P1"]}
    history = [("user", f"turn {i}") for i in range(10)]
    GroqProvider("k", "m", url=groq_url).generate(_permit(GenerationGate()), _request(history))
    messages = FakeGroq.requests[0]["messages"]
    assert [m["content"] for m in messages[2:-1]] == ["turn 6", "turn 7", "turn 8", "turn 9"]
    dumped = json.dumps(FakeGroq.requests[0])
    for forbidden in ("user_id", "email", "@", "supabase"):
        assert forbidden not in dumped


@pytest.mark.parametrize(
    ("status", "reason"), [(429, "quota"), (500, "http_500"), (401, "http_401")]
)
def test_groq_http_errors_become_provider_errors_without_the_body(
    groq_url: str, status: int, reason: str
) -> None:
    FakeGroq.status = status
    with pytest.raises(ProviderError) as caught:
        GroqProvider("k", "m", url=groq_url).generate(_permit(GenerationGate()), _request())
    assert str(caught.value) == reason
    assert "echo" not in str(caught.value)


@pytest.mark.parametrize(
    "reply",
    [{"text": "missing keys"}, {"reply": 5, "citations": []}, {"reply": "x", "citations": "P1"}],
)
def test_malformed_groq_output_is_rejected(groq_url: str, reply: dict[str, Any]) -> None:
    FakeGroq.reply = reply
    with pytest.raises(ProviderError, match="malformed"):
        GroqProvider("k", "m", url=groq_url).generate(_permit(GenerationGate()), _request())


def test_unreachable_groq_is_a_provider_error() -> None:
    provider = GroqProvider("k", "m", url="http://127.0.0.1:1/openai/v1/chat/completions")
    with pytest.raises(ProviderError, match="unreachable"):
        provider.generate(_permit(GenerationGate()), _request())


def test_groq_through_the_full_pipeline(groq_url: str, curated: None) -> None:
    FakeGroq.reply = {
        "reply": "Grounding means slowing down and noticing your feet.",
        "citations": ["P1"],
    }
    client = chat_client(make_runtime(provider=GroqProvider("k", "m", url=groq_url)))
    consent(client)
    body = send(client, "Can you explain a simple grounding exercise?").json()
    assert body["status"] == "reply"
    assert body["reply"]["text"].startswith("Grounding means")
    assert body["reply"]["citations"][0]["publisher"] == "World Health Organization"


def test_a_model_citing_an_unretrieved_passage_is_refused(groq_url: str, curated: None) -> None:
    FakeGroq.reply = {"reply": "Made-up advice.", "citations": ["P9"]}
    client = chat_client(make_runtime(provider=GroqProvider("k", "m", url=groq_url)))
    consent(client)
    assert (
        send(client, "Can you explain a simple grounding exercise?").json()["status"]
        == "unable_to_answer"
    )


def test_groq_quota_exhaustion_is_reported_as_unavailable(
    groq_url: str, curated: None, capsys: pytest.CaptureFixture[str]
) -> None:
    FakeGroq.status = 429
    client = chat_client(make_runtime(provider=GroqProvider("k", "m", url=groq_url)))
    consent(client)
    capsys.readouterr()
    body = send(client, "Can you explain a simple grounding exercise?").json()
    assert body["status"] == "unavailable"
    assert body["reply"] is None
    out = capsys.readouterr().out
    failures = [r for r in parse_log_lines(out) if r.get("message") == "chat_generation_failed"]
    assert failures and failures[0]["category"] == "provider_quota"  # sanitized category
    assert "grounding" not in out.lower() and "echo" not in out  # no message, no body


def test_an_edge_rejection_is_logged_by_category(
    groq_url: str,
    curated: None,
    capsys: pytest.CaptureFixture[str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.ai.provider.groq.USER_AGENT", "Python-urllib/3.12")
    client = chat_client(make_runtime(provider=GroqProvider("k", "m", url=groq_url)))
    consent(client)
    capsys.readouterr()
    assert send(client, "What is mindfulness?").json()["status"] == "unavailable"
    failures = [
        r
        for r in parse_log_lines(capsys.readouterr().out)
        if r.get("message") == "chat_generation_failed"
    ]
    assert failures[0]["category"] == "provider_http_403"


def test_groq_is_never_built_without_the_recorded_approval() -> None:
    base: dict[str, Any] = {
        "environment": "test",
        "chat_enabled": True,
        "chat_safety_policy": "synthetic-test-v0",
    }
    assert (
        build_chat_runtime(Settings(**base, chat_provider="groq", groq_api_key=SecretStr("k")))
        is None
    )
    assert (
        build_chat_runtime(
            Settings(**base, chat_provider="groq", chat_external_provider_approved=True)
        )
        is None
    )
    runtime = build_chat_runtime(
        Settings(
            **base,
            chat_provider="groq",
            groq_api_key=SecretStr("k"),
            chat_external_provider_approved=True,
        )
    )
    assert runtime is not None and isinstance(runtime.provider, GroqProvider)
    fake = build_chat_runtime(Settings(**base))
    assert fake is not None and fake.provider.kind == "scripted"  # type: ignore[attr-defined]


def test_config_says_when_replies_come_from_a_model(groq_url: str, curated: None) -> None:
    from tests.auth_helpers import bearer

    client = chat_client(
        make_runtime(provider=GroqProvider("k", "openai/gpt-oss-20b", url=groq_url))
    )
    consent(client)
    body = client.get("/chat/config", headers=bearer()).json()
    assert body["generator"] == "model"
    assert body["model"] == "openai/gpt-oss-20b"


# --- Provenance rules for real sources ----------------------------------------------

_DOC = (
    "---\nslug: s\ntitle: t\npublisher: p\nsource_ref: https://example.org\nversion_label: 1\n"
    "content_type: x\nlanguage: en\nage_bands: adult\ndomains: emotional\nreview_status: {status}\n"
    "{extra}---\nBody text.\n"
)


def test_draft_sources_must_declare_licence_and_review_state() -> None:
    with pytest.raises(IngestError, match="missing provenance"):
        parse(_DOC.format(status="draft", extra=""))
    parse(
        _DOC.format(
            status="draft",
            extra="licence: x\npermitted_use: y\nretrieved_on: 2026-10-19\nclinical_review: none\n",
        )
    )


def test_approved_requires_an_actual_clinical_review() -> None:
    extra = (
        "reviewed_by: r\nreviewed_at: 2026-01-01T00:00:00+00:00\nlicence: x\npermitted_use: y\n"
        "retrieved_on: 2026-10-19\nclinical_review: none\n"
    )
    with pytest.raises(IngestError, match="clinical_review: none"):
        parse(_DOC.format(status="approved", extra=extra))


def test_every_curated_source_is_draft_with_licence_and_no_clinical_review() -> None:
    for path in sorted(SOURCES.glob("*.md")):
        meta = parse(path.read_text(encoding="utf-8")).meta
        assert meta["review_status"] == "draft", path.name
        assert meta["clinical_review"] == "none", path.name
        assert meta["licence"] and meta["permitted_use"], path.name
        assert meta["source_ref"].startswith("https://"), path.name


# --- Deterministic, provenance-aware ingestion (0004) -------------------------------


def test_curated_import_stores_provenance_and_is_repeatable(db_engine: Engine) -> None:
    from sqlalchemy import text

    from app.knowledge.ingest import ingest_directory_report

    with Session(db_engine) as session, session.begin():
        first = ingest_directory_report(session, SOURCES)
    with Session(db_engine) as session, session.begin():
        second = ingest_directory_report(session, SOURCES)
    assert {r.status for r in first} == {"new"}
    assert {r.status for r in second} == {"unchanged"}  # same hashes: chunks untouched
    assert [r.content_sha256 for r in first] == [r.content_sha256 for r in second]
    with db_engine.connect() as conn:
        rows = conn.execute(
            text(
                "select slug, source_verified, clinical_review, licence, retrieved_on "
                "from app.knowledge_sources order by slug"
            )
        ).fetchall()
        sections = [r[0] for r in conn.execute(text("select section from app.knowledge_chunks"))]
        hashes = conn.execute(
            text("select count(*), count(distinct content_sha256) from app.knowledge_chunks")
        ).one()
    assert len(rows) == SOURCE_COUNT
    for slug, verified, clinical, licence, retrieved in rows:
        assert verified is True and clinical == "none" and licence and retrieved, slug
    assert all(sections), "every curated passage has its heading as section"
    assert hashes[0] == hashes[1]


def test_a_changed_document_is_rechunked_and_duplicates_are_stored_once(
    db_engine: Engine,
) -> None:
    from app.knowledge.ingest import ingest_document_result

    meta = (
        "---\nslug: dup\ntitle: t\npublisher: p\nsource_ref: https://example.org\n"
        "version_label: 1\ncontent_type: x\nlanguage: en\nage_bands: adult\n"
        "review_status: synthetic\n---\n"
    )
    long = "Same long passage. " * 30  # ~570 chars: each paragraph becomes its own chunk
    body = f"{long}\n\n{long}\n"
    with Session(db_engine) as session, session.begin():
        _, first = ingest_document_result(session, parse(meta + body))
        _, again = ingest_document_result(session, parse(meta + body))
        _, changed = ingest_document_result(session, parse(meta + "A new passage.\n"))
    assert (first.status, first.chunks) == ("new", 1)  # two identical chunks, stored once
    assert again.status == "unchanged"
    assert (changed.status, changed.chunks) == ("updated", 1)


@pytest.mark.parametrize(
    ("language", "rule"),
    [("en", "Write the whole reply in English."), ("ar", "Egyptian Arabic, in Arabic script")],
)
def test_the_server_decides_the_reply_language(groq_url: str, language: str, rule: str) -> None:
    """2026-10-20: an English question was answered in Arabic when the model had to guess."""
    from dataclasses import replace

    FakeGroq.reply = {"reply": "ok", "citations": ["P1"]}
    request = replace(_request(), reply_language=language)
    GroqProvider("k", "m", url=groq_url).generate(_permit(GenerationGate()), request)
    assert rule in FakeGroq.requests[0]["messages"][0]["content"]


def test_passage_ids_are_removed_from_the_reply_text(groq_url: str) -> None:
    FakeGroq.reply = {
        "reply": "Walking can lift mood (P1, P2). Sleep matters too [P2].",
        "citations": ["P1", "P2"],
    }
    result = GroqProvider("k", "m", url=groq_url).generate(_permit(GenerationGate()), _request())
    assert result.text == "Walking can lift mood. Sleep matters too."
    assert result.cited_chunk_ids == ["chunk-a", "chunk-b"]
