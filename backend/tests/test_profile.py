"""Profile API: sync on first use, retrieval, updates, validation and isolation."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import pytest
from sqlalchemy import Engine, text

from tests.auth_helpers import EMAIL, EMAIL_B, USER_B_ID, USER_ID, api_client, bearer


def rows(engine: Engine, sql: str, **params: Any) -> list[Any]:
    with engine.connect() as connection:
        return list(connection.execute(text(sql), params))


def audit_actions(engine: Engine) -> list[str]:
    return [
        r.action for r in rows(engine, "SELECT action FROM app.audit_events ORDER BY created_at")
    ]


# --- Authentication -----------------------------------------------------------


@pytest.mark.parametrize(("method", "path"), [("GET", "/profile"), ("PATCH", "/profile")])
def test_profile_requires_authentication(method: str, path: str) -> None:
    response = api_client().request(method, path, json={})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_invalid_token_cannot_read_profile() -> None:
    response = api_client().get("/profile", headers={"Authorization": "Bearer aaaa.bbbb.cccc"})
    assert response.status_code == 401


# --- Create / synchronise -----------------------------------------------------


def test_first_request_creates_an_empty_profile(db_engine: Engine) -> None:
    response = api_client().get("/profile", headers=bearer())
    assert response.status_code == 200
    body = response.json()
    assert body["display_name"] is None
    assert body["goals"] == []
    assert body["preferences"] == {}
    [user] = rows(db_engine, "SELECT id, supabase_user_id FROM app.users")
    assert str(user.id) == body["user_id"]
    assert str(user.supabase_user_id) == USER_ID
    assert audit_actions(db_engine) == ["user.created"]


def test_profile_is_created_once(db_engine: Engine) -> None:
    client = api_client()
    first = client.get("/profile", headers=bearer()).json()
    second = client.get("/profile", headers=bearer()).json()
    me = client.get("/me", headers=bearer()).json()
    assert first["user_id"] == second["user_id"] == me["user_id"]
    assert len(rows(db_engine, "SELECT id FROM app.users")) == 1
    assert audit_actions(db_engine) == ["user.created"]


def test_concurrent_first_requests_create_one_profile(db_engine: Engine) -> None:
    def fetch(_: int) -> str:
        return str(api_client().get("/profile", headers=bearer()).json()["user_id"])

    with ThreadPoolExecutor(max_workers=6) as pool:
        ids = set(pool.map(fetch, range(6)))
    assert len(ids) == 1
    assert len(rows(db_engine, "SELECT id FROM app.users")) == 1
    assert audit_actions(db_engine) == ["user.created"]


def test_profile_stores_no_email_or_credentials(db_engine: Engine) -> None:
    api_client().get("/profile", headers=bearer())
    [row] = rows(db_engine, "SELECT row_to_json(u)::text AS data FROM app.users u")
    assert EMAIL not in row.data


# --- Update -------------------------------------------------------------------


def test_update_display_name(db_engine: Engine) -> None:
    client = api_client()
    response = client.patch("/profile", headers=bearer(), json={"display_name": "  Salma  "})
    assert response.status_code == 200
    assert response.json()["display_name"] == "Salma"
    assert client.get("/profile", headers=bearer()).json()["display_name"] == "Salma"
    assert client.get("/me", headers=bearer()).json()["display_name"] == "Salma"


def test_arabic_display_name_is_accepted() -> None:
    response = api_client().patch("/profile", headers=bearer(), json={"display_name": "سلمى"})
    assert response.status_code == 200
    assert response.json()["display_name"] == "سلمى"


def test_null_clears_display_name_and_omitted_fields_are_unchanged() -> None:
    client = api_client()
    client.patch("/profile", headers=bearer(), json={"display_name": "Salma"})
    assert client.patch("/profile", headers=bearer(), json={}).json()["display_name"] == "Salma"
    cleared = client.patch("/profile", headers=bearer(), json={"display_name": None})
    assert cleared.json()["display_name"] is None


def test_update_is_audited_by_field_name_only(db_engine: Engine) -> None:
    api_client().patch("/profile", headers=bearer(), json={"display_name": "Salma"})
    [event] = rows(
        db_engine,
        "SELECT metadata::text AS metadata FROM app.audit_events "
        "WHERE action = 'user.profile_updated'",
    )
    assert event.metadata == '{"fields": ["display_name"]}'
    assert "Salma" not in event.metadata


def test_no_op_update_is_not_audited(db_engine: Engine) -> None:
    client = api_client()
    client.patch("/profile", headers=bearer(), json={"display_name": "Salma"})
    client.patch("/profile", headers=bearer(), json={"display_name": "Salma"})
    assert audit_actions(db_engine).count("user.profile_updated") == 1


def test_empty_goals_and_preferences_are_accepted() -> None:
    response = api_client().patch(
        "/profile", headers=bearer(), json={"goals": [], "preferences": {}}
    )
    assert response.status_code == 200
    assert (response.json()["goals"], response.json()["preferences"]) == ([], {})


# --- Invalid input ------------------------------------------------------------


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"display_name": "   "}, "display_name"),
        ({"display_name": "x" * 51}, "display_name"),
        ({"display_name": "bad\u0000name"}, "display_name"),
        ({"display_name": "line\nbreak"}, "display_name"),
        ({"display_name": 123}, "display_name"),
        ({"goals": ["sleep better"]}, "goals"),  # no goal vocabulary is approved yet (D-22)
        ({"goals": "sleep"}, "goals"),
        ({"preferences": {"language": "ar"}}, "preferences.language"),  # no keys yet (D-23)
        ({"user_id": USER_B_ID}, "user_id"),
        ({"supabase_user_id": USER_B_ID}, "supabase_user_id"),
        ({"email": "x@example.com"}, "email"),
    ],
)
def test_invalid_profile_update_is_rejected(
    payload: dict[str, Any], field: str, db_engine: Engine
) -> None:
    client = api_client()
    client.get("/profile", headers=bearer())
    response = client.patch("/profile", headers=bearer(), json=payload)
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_failed"
    assert field in [f["field"] for f in error["fields"]]
    # Submitted values are never echoed back.
    for value in payload.values():
        if isinstance(value, str) and value.strip():
            assert value not in response.text
    assert audit_actions(db_engine) == ["user.created"]


def test_malformed_json_is_rejected() -> None:
    response = api_client().patch(
        "/profile",
        headers={**bearer(), "Content-Type": "application/json"},
        content=b"{not json",
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"


# --- Authorisation / isolation -----------------------------------------------


def test_users_only_see_their_own_profile() -> None:
    client = api_client()
    client.patch("/profile", headers=bearer(), json={"display_name": "Salma"})
    b = client.get("/profile", headers=bearer(sub=USER_B_ID, email=EMAIL_B)).json()
    a = client.get("/profile", headers=bearer()).json()
    assert b["display_name"] is None
    assert b["user_id"] != a["user_id"]


def test_client_supplied_user_id_cannot_select_another_profile() -> None:
    client = api_client()
    a_id = client.patch("/profile", headers=bearer(), json={"display_name": "Salma"}).json()[
        "user_id"
    ]
    b_headers = {**bearer(sub=USER_B_ID, email=EMAIL_B), "X-User-Id": a_id}
    response = client.get("/profile", headers=b_headers, params={"user_id": a_id})
    assert response.status_code == 200
    assert response.json()["user_id"] != a_id
    assert response.json()["display_name"] is None


def test_another_users_update_cannot_change_my_profile() -> None:
    client = api_client()
    a_id = client.patch("/profile", headers=bearer(), json={"display_name": "Salma"}).json()[
        "user_id"
    ]
    attempt = client.patch(
        "/profile",
        headers=bearer(sub=USER_B_ID, email=EMAIL_B),
        params={"user_id": a_id},
        json={"display_name": "Hijacked"},
    )
    assert attempt.status_code == 200
    assert attempt.json()["user_id"] != a_id  # B changed only B's own profile
    assert client.get("/profile", headers=bearer()).json()["display_name"] == "Salma"


def test_deleted_account_cannot_use_profile(db_engine: Engine) -> None:
    client = api_client()
    client.get("/profile", headers=bearer())
    with db_engine.begin() as connection:
        connection.execute(text("UPDATE app.users SET deleted_at = now()"))
    response = client.get("/profile", headers=bearer())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "account_unavailable"


def test_database_not_configured_fails_closed() -> None:
    from tests.auth_helpers import auth_settings

    client = api_client(auth_settings(database_url=None))
    response = client.get("/profile", headers=bearer())
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"
