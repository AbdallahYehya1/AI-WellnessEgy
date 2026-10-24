"""Daily Reflection (D-57): several feelings, optional factors, descriptive insights."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from tests.auth_helpers import EMAIL_B, USER_B_ID, api_client, bearer
from tests.test_chat import consent

B = {"sub": USER_B_ID, "email": EMAIL_B}


@pytest.fixture
def client() -> TestClient:
    c = api_client()
    consent(c)
    consent(c, **B)
    return c


def reflect(
    c: TestClient, emotions: list[str], factors: list[str] | None = None, **auth: Any
) -> Any:
    body: dict[str, Any] = {"emotions": emotions}
    if factors is not None:
        body["factors"] = factors
    return c.post("/mood/reflections", headers=bearer(**auth), json=body)


def test_a_reflection_can_hold_several_feelings_and_factors(client: TestClient) -> None:
    response = reflect(client, ["excited", "anxious"], ["work", "studies"])
    assert response.status_code == 201
    body = response.json()
    # Optional next steps: only assistants that are ready, never a diagnosis.
    assert body["suggested_assistants"] == ["career", "growth", "emotional"]
    entry = client.get("/mood/history", headers=bearer()).json()["checkins"][0]
    assert entry["kind"] == "reflection"
    assert entry["mood_score"] is None  # no good-to-bad score
    assert entry["emotions"] == ["excited", "anxious"]
    assert entry["factors"] == ["work", "studies"]


def test_factors_are_optional(client: TestClient) -> None:
    assert reflect(client, ["calm"]).status_code == 201


@pytest.mark.parametrize(
    "payload",
    [
        {"emotions": []},
        {"emotions": ["hopeless"]},
        {"emotions": ["calm", "calm"]},
        {"emotions": ["calm"], "factors": ["dating apps"]},
        {"emotions": ["calm"], "note": "something private"},  # no notes while D-32 is open
        {"emotions": ["calm"], "mood_score": 3},
        {"emotions": ["calm"], "user_id": USER_B_ID},
    ],
)
def test_invalid_reflections_are_rejected(client: TestClient, payload: dict[str, Any]) -> None:
    response = client.post("/mood/reflections", headers=bearer(), json=payload)
    assert response.status_code == 422


def test_old_check_ins_keep_working_and_display_unchanged(client: TestClient) -> None:
    assert (
        client.post("/mood/checkins", headers=bearer(), json={"mood_score": 2}).status_code == 201
    )
    reflect(client, ["tired"], ["sleep"])
    entries = client.get("/mood/history", headers=bearer()).json()["checkins"]
    kinds = {e["kind"]: e for e in entries}
    assert kinds["checkin"]["mood_score"] == 2 and kinds["checkin"]["emotions"] == []
    assert kinds["reflection"]["emotions"] == ["tired"]


def _backdate(engine: Engine, days_ago: int) -> None:
    with engine.begin() as conn:
        conn.execute(
            text(
                "update app.mood_checkins set submitted_at = now() - make_interval(days => :d) "
                "where id = (select id from app.mood_checkins order by submitted_at desc limit 1)"
            ),
            {"d": days_ago},
        )


def test_insights_describe_counts_without_claiming_causes(
    client: TestClient, db_engine: Engine
) -> None:
    now = datetime.now(UTC)
    week_days = now.weekday()  # days already passed in this week (Monday start)
    for i, (emotions, factors) in enumerate(
        [
            (["anxious"], ["work"]),
            (["anxious", "tired"], ["work", "sleep"]),
            (["calm"], []),
            (["anxious"], ["work"]),
        ]
    ):
        reflect(client, emotions, factors)
        _backdate(db_engine, min(i, week_days))
    insights = client.get(
        "/mood/insights", headers=bearer(), params={"period": "month", "tz_offset": 0}
    ).json()
    assert insights["reflections"] >= 1
    labels = {c["label"]: c["count"] for c in insights["emotions"]}
    assert labels["anxious"] >= 1
    assert "score" not in str(insights).lower()
    for link in insights["links"]:  # "anxious on N days; work marked on M of them"
        assert set(link) == {"emotion", "factor", "days"}


def test_insights_show_when_there_is_not_enough_data(client: TestClient) -> None:
    reflect(client, ["good"])
    insights = client.get("/mood/insights", headers=bearer(), params={"period": "week"}).json()
    assert insights["enough_data"] is False
    assert insights["reflections"] == 1


def test_insights_and_history_are_private_to_their_owner(client: TestClient) -> None:
    for _ in range(3):
        reflect(client, ["sad"], ["family"])
    other = client.get("/mood/insights", headers=bearer(**B), params={"period": "month"}).json()
    assert other["reflections"] == 0 and other["emotions"] == []
    assert client.get("/mood/history", headers=bearer(**B)).json()["checkins"] == []


def test_insights_need_consent_and_a_valid_period(db_engine: Engine) -> None:
    c = api_client()
    assert c.get("/mood/insights", headers=bearer()).status_code == 403  # no consent yet
    consent(c)
    assert c.get("/mood/insights", headers=bearer(), params={"period": "year"}).status_code == 422
    params = {"tz_offset": 99999}
    assert c.get("/mood/insights", headers=bearer(), params=params).status_code == 422


def test_week_boundaries_follow_the_users_time_zone(client: TestClient) -> None:
    reflect(client, ["happy"])
    cairo = client.get(
        "/mood/insights", headers=bearer(), params={"period": "week", "tz_offset": 180}
    ).json()
    start = datetime.fromisoformat(cairo["start"])
    assert start.weekday() == 0  # Monday
    assert datetime.fromisoformat(cairo["end"]) - start == timedelta(days=7)
