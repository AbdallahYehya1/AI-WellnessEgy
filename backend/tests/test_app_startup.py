from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from tests.conftest import parse_log_lines


def test_create_app_returns_fastapi_instance() -> None:
    app = create_app(Settings())
    assert isinstance(app, FastAPI)
    assert app.title == "AI Wellness Egypt API"


def test_module_level_app_is_importable() -> None:
    from app.main import app

    assert isinstance(app, FastAPI)


def test_startup_and_shutdown_are_logged(capsys: pytest.CaptureFixture[str]) -> None:
    with TestClient(create_app(Settings())):
        pass
    messages = [line["message"] for line in parse_log_lines(capsys.readouterr().out)]
    assert "application_startup" in messages
    assert "application_shutdown" in messages


def test_only_milestone_one_routes_are_exposed() -> None:
    app = create_app(Settings(environment="development"))
    assert set(app.openapi()["paths"]) == {"/health"}


def test_docs_enabled_outside_production() -> None:
    with TestClient(create_app(Settings(environment="development"))) as client:
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200


def test_docs_disabled_in_production() -> None:
    with TestClient(create_app(Settings(environment="production"))) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/redoc").status_code == 404
        assert client.get("/openapi.json").status_code == 404
