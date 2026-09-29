from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core.config import Environment, Settings
from app.main import create_app


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app(Settings(environment="test")))


def test_health_returns_ok(client: TestClient) -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("environment", ["development", "staging", "production"])
def test_health_never_exposes_environment(environment: Environment) -> None:
    client = TestClient(create_app(Settings(environment=environment)))
    response = client.get("/health")
    assert response.json() == {"status": "ok"}
    assert environment not in response.text


def test_health_sets_request_id_header(client: TestClient) -> None:
    request_id = client.get("/health").headers["X-Request-ID"]
    assert uuid.UUID(request_id).version == 4


def test_health_rejects_other_methods(client: TestClient) -> None:
    assert client.post("/health").status_code == 405


def test_unknown_route_returns_404(client: TestClient) -> None:
    assert client.get("/does-not-exist").status_code == 404
