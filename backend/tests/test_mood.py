"""Mood check-ins: auth, consent gate, ownership, validation, persistence, privacy."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.consent.catalog import PLACEHOLDER_V1
from tests.auth_helpers import EMAIL_B, USER_B_ID, api_client, bearer
from tests.conftest import parse_log_lines

NOTE = "slept badly, worried about exams"  # stands in for sensitive free text


def consent(client: TestClient, **auth: Any) -> None:
    response = client.post(
        "/consents",
        headers=bearer(**auth),
        json={"version": PLACEHOLDER_V1.version, "granted": True, "consent_type": "required"},
    )
    assert response.status_code == 201


def checkin(client: TestClient, payload: dict[str, Any] | None = None, **auth: Any) -> Any:
    body = {"mood_score": 4} if payload is None else payload  # `{}` must be sent as-is
    return client.post("/mood/checkins", headers=bearer(**auth), json=body)


def history(client: TestClient, params: dict[str, Any] | None = None, **auth: Any) -> Any:
    return client.get("/mood/history", headers=bearer(**auth), params=params or {})


def rows(engine: Engine, sql: str) -> list[Any]:
    with engine.connect() as connection:
        return list(connection.execute(text(sql)))


@pytest.fixture
def client() -> TestClient:
    c = api_client()
    consent(c)
    return c


# --- Authentication -----------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), [("POST", "/mood/checkins"), ("GET", "/mood/history")])
def test_mood_requires_authentication(method: str, path: str, db_engine: Engine) -> None:
    response = api_client().request(method, path, json={"mood_score": 3})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"
    assert rows(db_engine, "SELECT id FROM app.mood_checkins") == []


def test_invalid_token_is_rejected() -> None:
    response = api_client().get("/mood/history", headers={"Authorization": "Bearer a.b.c"})
    assert response.status_code == 401


def test_authenticated_consented_request_succeeds(client: TestClient) -> None:
    assert checkin(client).status_code == 201
    assert history(client).status_code == 200


# --- Consent gate -------------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), [("POST", "/mood/checkins"), ("GET", "/mood/history")])
def test_mood_requires_current_consent(method: str, path: str, db_engine: Engine) -> None:
    response = api_client().request(method, path, headers=bearer(), json={"mood_score": 3})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "consent_required"
    assert rows(db_engine, "SELECT id FROM app.mood_checkins") == []


def test_declined_consent_blocks_mood(db_engine: Engine) -> None:
    c = api_client()
    c.post(
        "/consents",
        headers=bearer(),
        json={"version": PLACEHOLDER_V1.version, "granted": False, "consent_type": "required"},
    )
    assert checkin(c).status_code == 403


# --- Create / persistence -----------------------------------------------------


def test_checkin_is_stored_exactly(client: TestClient, db_engine: Engine) -> None:
    response = checkin(client, {"mood_score": 2, "note": f"  {NOTE}\n"})
    assert response.status_code == 201
    body = response.json()
    assert set(body) == {"checkin_id", "submitted_at"}
    [row] = rows(db_engine, "SELECT * FROM app.mood_checkins")
    assert str(row.id) == body["checkin_id"]
    assert (row.mood_score, row.tags) == (2, [])
    assert row.note == f"  {NOTE}\n"  # not trimmed or rewritten
    profile_id = client.get("/profile", headers=bearer()).json()["user_id"]
    assert str(row.user_id) == profile_id


def test_note_is_optional(client: TestClient, db_engine: Engine) -> None:
    assert checkin(client, {"mood_score": 5}).status_code == 201
    [row] = rows(db_engine, "SELECT note FROM app.mood_checkins")
    assert row.note is None


def test_submitted_at_is_set_by_the_server(client: TestClient) -> None:
    before = datetime.now(UTC)
    body = checkin(client).json()
    after = datetime.now(UTC)
    submitted = datetime.fromisoformat(body["submitted_at"])
    assert submitted.tzinfo is not None
    assert before - timedelta(seconds=5) <= submitted <= after + timedelta(seconds=5)


def test_client_cannot_set_submitted_at(client: TestClient) -> None:
    response = checkin(client, {"mood_score": 3, "submitted_at": "2001-01-01T00:00:00Z"})
    assert response.status_code == 422


def test_responses_contain_no_diagnostic_language(client: TestClient) -> None:
    created = checkin(client, {"mood_score": 1})
    listed = history(client)
    for response in (created, listed):
        lowered = response.text.lower()
        for word in ("diagnos", "depress", "disorder", "anxiety", "risk", "symptom", "clinical"):
            assert word not in lowered


# --- History ------------------------------------------------------------------


def test_history_is_newest_first_and_complete(client: TestClient) -> None:
    for score in (1, 2, 3, 4, 5):
        checkin(client, {"mood_score": score})
    body = history(client).json()
    assert [c["mood_score"] for c in body["checkins"]] == [5, 4, 3, 2, 1]
    first = body["checkins"][0]
    assert set(first) == {"checkin_id", "mood_score", "tags", "note", "submitted_at"}
    times = [c["submitted_at"] for c in body["checkins"]]
    assert times == sorted(times, reverse=True)


def test_history_returns_own_note(client: TestClient) -> None:
    checkin(client, {"mood_score": 3, "note": NOTE})
    assert history(client).json()["checkins"][0]["note"] == NOTE


def test_history_empty_for_new_user(client: TestClient) -> None:
    assert history(client).json() == {"checkins": []}


def test_history_limit(client: TestClient) -> None:
    for score in (1, 2, 3):
        checkin(client, {"mood_score": score})
    body = history(client, {"limit": 2}).json()
    assert [c["mood_score"] for c in body["checkins"]] == [3, 2]


def test_history_date_range(client: TestClient, db_engine: Engine) -> None:
    for score in (1, 2, 3):
        checkin(client, {"mood_score": score})
    with db_engine.begin() as connection:
        connection.execute(
            text(
                "UPDATE app.mood_checkins SET submitted_at = CASE mood_score "
                "WHEN 1 THEN '2026-01-01T10:00:00Z'::timestamptz "
                "WHEN 2 THEN '2026-01-02T10:00:00Z'::timestamptz "
                "ELSE '2026-01-03T10:00:00Z'::timestamptz END"
            )
        )
    body = history(client, {"from": "2026-01-02T00:00:00Z", "to": "2026-01-03T10:00:00Z"}).json()
    assert [c["mood_score"] for c in body["checkins"]] == [2]  # from inclusive, to exclusive


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-01-02"},  # no time / timezone
        {"from": "2026-01-02T00:00:00"},  # naive datetime
        {"to": "yesterday"},
        {"limit": 0},
        {"limit": 101},
        {"limit": "ten"},
        {"user_id": USER_B_ID},
    ],
)
def test_invalid_history_query_is_rejected(client: TestClient, params: dict[str, Any]) -> None:
    response = history(client, params)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


def test_reversed_range_is_rejected(client: TestClient) -> None:
    response = history(client, {"from": "2026-01-03T00:00:00Z", "to": "2026-01-02T00:00:00Z"})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_range"


# --- Validation ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"mood_score": 0}, "mood_score"),
        ({"mood_score": 6}, "mood_score"),
        ({"mood_score": -1}, "mood_score"),
        ({"mood_score": "3"}, "mood_score"),
        ({"mood_score": 3.0}, "mood_score"),
        ({"mood_score": 3.5}, "mood_score"),
        ({"mood_score": True}, "mood_score"),
        ({"mood_score": None}, "mood_score"),
        ({}, "mood_score"),
        ({"note": "no score"}, "mood_score"),
        ({"mood_score": 3, "tags": ["tired"]}, "tags"),  # no tag vocabulary yet (D-30)
        ({"mood_score": 3, "tags": "tired"}, "tags"),
        ({"mood_score": 3, "note": ""}, "note"),
        ({"mood_score": 3, "note": "   "}, "note"),
        ({"mood_score": 3, "note": "x" * 1001}, "note"),
        ({"mood_score": 3, "note": "bad\u0000char"}, "note"),
        ({"mood_score": 3, "note": "zero​width"}, "note"),
        ({"mood_score": 3, "user_id": USER_B_ID}, "user_id"),
    ],
)
def test_invalid_checkin_is_rejected(
    client: TestClient, payload: dict[str, Any], field: str, db_engine: Engine
) -> None:
    response = checkin(client, payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_failed"
    assert field in [f["field"] for f in error["fields"]]
    assert NOTE not in response.text
    assert rows(db_engine, "SELECT id FROM app.mood_checkins") == []


def test_note_with_line_breaks_and_arabic_is_accepted(client: TestClient) -> None:
    note = "نمت كويس\nبس متوتر شوية\t."
    assert checkin(client, {"mood_score": 3, "note": note}).status_code == 201
    assert history(client).json()["checkins"][0]["note"] == note


def test_note_at_max_length_is_accepted(client: TestClient) -> None:
    assert checkin(client, {"mood_score": 3, "note": "x" * 1000}).status_code == 201


def test_malformed_json_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/mood/checkins",
        headers={**bearer(), "Content-Type": "application/json"},
        content=b"{mood_score: 3",
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


def test_database_constraint_backs_up_the_score_range(
    client: TestClient, db_engine: Engine
) -> None:
    checkin(client)
    with pytest.raises(Exception, match="mood_score_range"), db_engine.begin() as connection:
        connection.execute(text("UPDATE app.mood_checkins SET mood_score = 9"))


# --- Ownership / isolation ----------------------------------------------------


def test_users_only_see_their_own_history(client: TestClient) -> None:
    consent(client, sub=USER_B_ID, email=EMAIL_B)
    checkin(client, {"mood_score": 1, "note": NOTE})
    checkin(client, {"mood_score": 5}, sub=USER_B_ID, email=EMAIL_B)

    a = history(client).json()["checkins"]
    b = history(client, sub=USER_B_ID, email=EMAIL_B).json()["checkins"]
    assert [c["mood_score"] for c in a] == [1]
    assert [c["mood_score"] for c in b] == [5]
    assert NOTE not in json.dumps(b)


def test_client_supplied_user_id_cannot_read_another_users_history(client: TestClient) -> None:
    checkin(client, {"mood_score": 1, "note": NOTE})
    a_profile = client.get("/profile", headers=bearer()).json()["user_id"]
    consent(client, sub=USER_B_ID, email=EMAIL_B)

    response = client.get(
        "/mood/history",
        headers={**bearer(sub=USER_B_ID, email=EMAIL_B), "X-User-Id": a_profile},
    )
    assert response.status_code == 200
    assert response.json() == {"checkins": []}


def test_client_supplied_user_id_cannot_write_for_another_user(
    client: TestClient, db_engine: Engine
) -> None:
    a_profile = client.get("/profile", headers=bearer()).json()["user_id"]
    consent(client, sub=USER_B_ID, email=EMAIL_B)
    response = client.post(
        "/mood/checkins",
        headers={**bearer(sub=USER_B_ID, email=EMAIL_B), "X-User-Id": a_profile},
        params={"user_id": a_profile},
        json={"mood_score": 2},
    )
    assert response.status_code == 201
    [row] = rows(db_engine, "SELECT user_id FROM app.mood_checkins")
    assert str(row.user_id) != a_profile  # stored for B, the token's owner
    assert history(client).json() == {"checkins": []}


# --- Privacy: logs and audit --------------------------------------------------


def test_mood_content_never_reaches_logs(capsys: pytest.CaptureFixture[str]) -> None:
    with api_client() as c:
        consent(c)
        checkin(c, {"mood_score": 2, "note": NOTE})
        checkin(c, {"mood_score": 9, "note": NOTE})  # rejected
        history(c, {"from": "2026-01-01T00:00:00Z"})
    output = capsys.readouterr()
    logs = output.out + output.err
    assert NOTE not in logs
    assert '"mood_score"' not in logs
    assert "2026-01-01" not in logs  # query string not logged
    paths = {line.get("path") for line in parse_log_lines(output.out)}
    assert {"/mood/checkins", "/mood/history"} <= paths


def test_audit_records_the_event_but_no_mood_content(client: TestClient, db_engine: Engine) -> None:
    created = checkin(client, {"mood_score": 2, "note": NOTE}).json()
    [event] = rows(
        db_engine,
        "SELECT actor_user_id, target_type, target_id, metadata FROM app.audit_events "
        "WHERE action = 'mood.checkin_recorded'",
    )
    assert event.target_type == "mood_checkin"
    assert str(event.target_id) == created["checkin_id"]
    assert event.metadata == {}
    dump = json.dumps(
        [list(map(str, r)) for r in rows(db_engine, "SELECT * FROM app.audit_events")]
    )
    assert NOTE not in dump
    assert "mood_score" not in dump


def test_rejected_checkin_writes_no_audit_event(client: TestClient, db_engine: Engine) -> None:
    checkin(client, {"mood_score": 0})
    assert rows(db_engine, "SELECT id FROM app.audit_events WHERE action LIKE 'mood.%'") == []


def test_explicit_empty_tags_and_null_note_are_accepted(client: TestClient) -> None:
    response = checkin(client, {"mood_score": 3, "tags": [], "note": None})
    assert response.status_code == 201
    stored = history(client).json()["checkins"][0]
    assert (stored["tags"], stored["note"]) == ([], None)


def test_duplicate_tags_are_rejected(client: TestClient) -> None:
    response = checkin(client, {"mood_score": 3, "tags": ["a", "a"]})
    assert response.status_code == 422
    assert "tags" in [f["field"] for f in response.json()["error"]["fields"]]
