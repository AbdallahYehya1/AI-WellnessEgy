"""Consent API: explicit decisions, versioning, idempotency, isolation, audit, gating."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import Engine, text

from app.consent.catalog import PLACEHOLDER_V1, ConsentCatalog, ConsentDocument
from app.consent.dependencies import ConsentedUser
from app.main import create_app
from tests.auth_helpers import (
    EMAIL,
    EMAIL_B,
    USER_B_ID,
    api_client,
    auth_settings,
    bearer,
    fake_verifier,
)

V1 = PLACEHOLDER_V1.version
V2_DOC = ConsentDocument(
    version="2027-01-01.v2",
    consent_type="required",
    published_at=datetime(2027, 1, 1, tzinfo=UTC),
    summary_url="/onboarding/consent",
    pending_legal_review=True,
)
V2_CATALOG = ConsentCatalog([PLACEHOLDER_V1, V2_DOC], current_required_version=V2_DOC.version)


def accept(client: TestClient, version: str = V1, granted: bool = True, **auth: Any) -> Any:
    return client.post(
        "/consents",
        headers=bearer(**auth),
        json={"version": version, "granted": granted, "consent_type": "required"},
    )


def status(client: TestClient, **auth: Any) -> dict[str, Any]:
    response = client.get("/consents/me", headers=bearer(**auth))
    assert response.status_code == 200
    body: dict[str, Any] = response.json()
    return body


def consent_rows(engine: Engine) -> list[Any]:
    with engine.connect() as connection:
        return list(connection.execute(text("SELECT * FROM app.consents ORDER BY recorded_at")))


def audit_rows(engine: Engine, action: str) -> list[Any]:
    with engine.connect() as connection:
        return list(
            connection.execute(
                text("SELECT * FROM app.audit_events WHERE action = :a ORDER BY created_at"),
                {"a": action},
            )
        )


# --- Current version (public) ------------------------------------------------


def test_current_consent_is_public_and_flags_pending_review() -> None:
    response = api_client().get("/consents/current")
    assert response.status_code == 200
    assert response.json() == {
        "version": V1,
        "consent_type": "required",
        "published_at": "2026-09-29T00:00:00Z",
        "summary_url": "/onboarding/consent",
        "pending_legal_review": True,
    }


# --- Authentication -----------------------------------------------------------


def test_consent_status_requires_authentication() -> None:
    assert api_client().get("/consents/me").status_code == 401


def test_recording_consent_requires_authentication(db_engine: Engine) -> None:
    response = api_client().post(
        "/consents", json={"version": V1, "granted": True, "consent_type": "required"}
    )
    assert response.status_code == 401
    assert consent_rows(db_engine) == []


# --- No consent ---------------------------------------------------------------


def test_new_account_has_no_consent(db_engine: Engine) -> None:
    client = api_client()
    client.get("/me", headers=bearer())  # account exists...
    body = status(client)
    assert body == {
        "current_version": V1,
        "status": "missing",
        "recorded_version": None,
        "recorded_at": None,
    }
    assert consent_rows(db_engine) == []  # ...but nothing was assumed


# --- Create / retrieve --------------------------------------------------------


def test_grant_current_version(db_engine: Engine) -> None:
    client = api_client()
    response = accept(client)
    assert response.status_code == 201
    body = response.json()
    assert (body["version"], body["granted"]) == (V1, True)
    assert set(body) == {"consent_id", "version", "granted", "recorded_at"}

    current = status(client)
    assert current["status"] == "granted"
    assert current["recorded_version"] == V1
    [row] = consent_rows(db_engine)
    assert str(row.id) == body["consent_id"]
    assert (row.version, row.consent_type, row.granted, row.withdrawn_at) == (
        V1,
        "required",
        True,
        None,
    )


def test_declining_is_recorded_and_does_not_grant(db_engine: Engine) -> None:
    client = api_client()
    assert accept(client, granted=False).status_code == 201
    assert status(client)["status"] == "declined"
    assert accept(client, granted=True).status_code == 201
    assert status(client)["status"] == "granted"
    assert [r.granted for r in consent_rows(db_engine)] == [False, True]


# --- Duplicates ---------------------------------------------------------------


def test_repeated_submission_is_idempotent(db_engine: Engine) -> None:
    client = api_client()
    first = accept(client)
    second = accept(client)
    assert (first.status_code, second.status_code) == (201, 200)
    assert first.json()["consent_id"] == second.json()["consent_id"]
    assert len(consent_rows(db_engine)) == 1
    assert len(audit_rows(db_engine, "consent.recorded")) == 1


def test_concurrent_duplicate_submissions_store_one_record(db_engine: Engine) -> None:
    # Apps are built up front: building them in parallel races in pydantic's
    # schema cache, which is not what this test is about (the database is).
    clients = [api_client() for _ in range(6)]

    def submit(client: TestClient) -> int:
        return int(accept(client).status_code)

    with ThreadPoolExecutor(max_workers=6) as pool:
        codes = sorted(pool.map(submit, clients))
    assert codes == [200, 200, 200, 200, 200, 201]
    assert len(consent_rows(db_engine)) == 1


# --- Versions -----------------------------------------------------------------


def test_unknown_version_is_rejected(db_engine: Engine) -> None:
    response = accept(api_client(), version="1999-01-01.fake")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unknown_version"
    assert consent_rows(db_engine) == []


def test_new_version_does_not_inherit_old_consent(db_engine: Engine) -> None:
    accept(api_client())  # granted v1

    client_v2 = api_client(consent_catalog=V2_CATALOG)
    body = status(client_v2)
    assert body["current_version"] == V2_DOC.version
    assert body["status"] == "outdated"
    assert body["recorded_version"] == V1

    # The old version can no longer be (re)accepted...
    stale = accept(client_v2, version=V1)
    assert stale.status_code == 422
    assert stale.json()["error"]["code"] == "consent_version_not_current"

    # ...and accepting the new one adds a new record; v1's record is untouched.
    assert accept(client_v2, version=V2_DOC.version).status_code == 201
    assert status(client_v2)["status"] == "granted"
    assert [(r.version, r.granted) for r in consent_rows(db_engine)] == [
        (V1, True),
        (V2_DOC.version, True),
    ]


def test_optional_consent_types_are_not_published_yet() -> None:
    response = api_client().post(
        "/consents",
        headers=bearer(),
        json={"version": V1, "granted": True, "consent_type": "optional"},
    )
    assert response.status_code == 422


# --- Explicitness / invalid input --------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"version": V1, "granted": "yes", "consent_type": "required"},
        {"version": V1, "granted": 1, "consent_type": "required"},
        {"version": V1, "consent_type": "required"},
        {"version": V1, "granted": True},
        {"version": "", "granted": True, "consent_type": "required"},
        {"version": V1, "granted": True, "consent_type": "everything"},
        {"version": V1, "granted": True, "consent_type": "required", "user_id": USER_B_ID},
    ],
)
def test_invalid_consent_payload_is_rejected(payload: dict[str, Any], db_engine: Engine) -> None:
    response = api_client().post("/consents", headers=bearer(), json=payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_failed"
    assert consent_rows(db_engine) == []


# --- Isolation ----------------------------------------------------------------


def test_consent_is_per_user() -> None:
    client = api_client()
    accept(client)
    other = status(client, sub=USER_B_ID, email=EMAIL_B)
    assert other["status"] == "missing"
    assert other["recorded_version"] is None


def test_client_supplied_user_id_cannot_read_or_record_for_someone_else(db_engine: Engine) -> None:
    client = api_client()
    a_profile = client.get("/profile", headers=bearer()).json()["user_id"]
    b_headers = {**bearer(sub=USER_B_ID, email=EMAIL_B), "X-User-Id": a_profile}

    accept(client, sub=USER_B_ID, email=EMAIL_B)
    assert (
        client.get("/consents/me", headers=b_headers, params={"user_id": a_profile}).json()[
            "status"
        ]
        == "granted"
    )  # B's own status
    assert status(client)["status"] == "missing"  # A is unaffected
    [row] = consent_rows(db_engine)
    assert str(row.user_id) != a_profile


# --- Audit --------------------------------------------------------------------


def test_consent_change_is_audited_with_minimal_metadata(db_engine: Engine) -> None:
    client = api_client()
    token_header = bearer()
    recorded = client.post(
        "/consents",
        headers=token_header,
        json={"version": V1, "granted": True, "consent_type": "required"},
    ).json()
    profile_id = client.get("/profile", headers=bearer()).json()["user_id"]

    [event] = audit_rows(db_engine, "consent.recorded")
    assert str(event.actor_user_id) == profile_id
    assert event.target_type == "consent"
    assert str(event.target_id) == recorded["consent_id"]
    assert event.metadata == {"version": V1, "consent_type": "required", "granted": True}

    with db_engine.connect() as connection:
        dump = json.dumps(
            [list(map(str, r)) for r in connection.execute(text("SELECT * FROM app.audit_events"))]
        )
    assert EMAIL not in dump
    assert token_header["Authorization"].split(" ")[1] not in dump
    assert "eyJ" not in dump


def test_every_decision_change_is_audited(db_engine: Engine) -> None:
    client = api_client()
    accept(client, granted=False)
    accept(client, granted=True)
    accept(client, granted=True)  # duplicate: no new event
    granted = [e.metadata["granted"] for e in audit_rows(db_engine, "consent.recorded")]
    assert granted == [False, True]


# --- Gate for consent-requiring features --------------------------------------


def gated_client(catalog: ConsentCatalog | None = None) -> TestClient:
    settings = auth_settings()
    app: FastAPI = create_app(settings, fake_verifier(settings), consent_catalog=catalog)

    @app.get("/test-only/feature")
    def feature(user: ConsentedUser) -> dict[str, str]:
        return {"user_id": str(user.id)}

    return TestClient(app)


def test_feature_is_blocked_until_consent_is_granted() -> None:
    client = gated_client()
    blocked = client.get("/test-only/feature", headers=bearer())
    assert blocked.status_code == 403
    assert blocked.json()["error"]["code"] == "consent_required"

    accept(client, granted=False)
    assert client.get("/test-only/feature", headers=bearer()).status_code == 403

    accept(client, granted=True)
    assert client.get("/test-only/feature", headers=bearer()).status_code == 200


def test_feature_is_blocked_again_when_a_new_version_is_published() -> None:
    accept(gated_client())
    assert gated_client().get("/test-only/feature", headers=bearer()).status_code == 200
    response = gated_client(V2_CATALOG).get("/test-only/feature", headers=bearer())
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "consent_required"


def test_feature_gate_requires_authentication() -> None:
    assert gated_client().get("/test-only/feature").status_code == 401


def test_catalog_requires_a_published_current_version() -> None:
    with pytest.raises(ValueError, match="must be published"):
        ConsentCatalog([PLACEHOLDER_V1], current_required_version="not-published")
