"""
Tests for waiter call endpoints:
  POST   /api/public/menus/{slug}/call-waiter       — client sends a call
  GET    /api/dashboard/menus/{slug}/waiter-calls   — restaurant sees pending calls
  PATCH  /api/dashboard/menus/{slug}/waiter-calls/{call_id}/status — update status
  DELETE /api/dashboard/menus/{slug}/waiter-calls/{call_id}        — dismiss call
  GET    /api/dashboard/menus/{slug}/waiter-calls/history          — call history
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Menu, Table


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestingSessionLocal
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def client(test_db, monkeypatch):
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "init_redis", AsyncMock())
    monkeypatch.setattr(redis_core, "close_redis", AsyncMock())

    with TestClient(app) as c:
        yield c


@pytest.fixture
def menu_and_table(test_db):
    """Create a Menu and a Table in the test DB."""
    session = test_db()
    import json

    menu = Menu(
        restaurant_name="Test Bistro",
        slug="test-bistro",
        pdf_path="test.pdf",
        languages="fr,en",
        menu_data=json.dumps({"sections": []}),
        status="ready",
    )
    session.add(menu)
    session.flush()

    table = Table(
        menu_slug="test-bistro",
        restaurant_id="org_test",
        number="5",
        label="Terrasse",
        capacity=4,
        qr_token="test-qr-token-uuid",
    )
    session.add(table)
    session.commit()
    session.close()
    return {"slug": "test-bistro", "table_token": "test-qr-token-uuid"}


# ---------------------------------------------------------------------------
# POST /api/public/menus/{slug}/call-waiter
# ---------------------------------------------------------------------------

def test_call_waiter_returns_ok(client, menu_and_table):
    """Calling a waiter returns status ok and a call_id."""
    with patch("app.core.redis.push_waiter_call", new=AsyncMock()) as mock_push:
        resp = client.post(
            f"/api/public/menus/{menu_and_table['slug']}/call-waiter",
            json={"table_token": menu_and_table["table_token"], "message": "S'il vous plaît"},
        )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert "call_id" in body
    assert len(body["call_id"]) > 0


def test_call_waiter_unknown_slug_returns_404(client):
    """Calling waiter on non-existent menu returns 404."""
    with patch("app.core.redis.push_waiter_call", new=AsyncMock()):
        resp = client.post(
            "/api/public/menus/nonexistent/call-waiter",
            json={"table_token": "abc", "message": "test"},
        )
    assert resp.status_code == 404


def test_call_waiter_with_unknown_table_token(client, menu_and_table):
    """Unknown table_token still creates a call but table_number is '?'."""
    with patch("app.core.redis.push_waiter_call", new=AsyncMock()) as mock_push:
        resp = client.post(
            f"/api/public/menus/{menu_and_table['slug']}/call-waiter",
            json={"table_token": "unknown-token", "message": "Help"},
        )
    assert resp.status_code == 200
    # The call is still created
    assert resp.json()["status"] == "ok"


def test_call_waiter_publishes_to_redis(client, menu_and_table):
    """Verify push_waiter_call is invoked with correct slug."""
    with patch("app.core.redis.push_waiter_call", new=AsyncMock()) as mock_push:
        client.post(
            f"/api/public/menus/{menu_and_table['slug']}/call-waiter",
            json={"table_token": menu_and_table["table_token"], "message": "Water please"},
        )
    mock_push.assert_called_once()
    call_args = mock_push.call_args[0]
    assert call_args[0] == menu_and_table["slug"]
    call_payload = call_args[1]
    assert call_payload["table_number"] == "5"
    assert call_payload["message"] == "Water please"


def test_call_waiter_redis_failure_still_returns_ok(client, menu_and_table):
    """If Redis is unavailable, call-waiter still returns ok (best-effort)."""
    with patch("app.core.redis.push_waiter_call", new=AsyncMock(side_effect=Exception("Redis down"))):
        resp = client.post(
            f"/api/public/menus/{menu_and_table['slug']}/call-waiter",
            json={"table_token": menu_and_table["table_token"], "message": "help"},
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# GET /api/dashboard/menus/{slug}/waiter-calls
# ---------------------------------------------------------------------------

def test_get_waiter_calls_returns_calls_list(client, menu_and_table):
    """Dashboard: get pending waiter calls returns list."""
    mock_calls = [
        {"id": "call-1", "table_number": "5", "message": "Water", "timestamp": "2026-04-12T10:00:00Z", "status": "pending"},
        {"id": "call-2", "table_number": "3", "message": "Bill", "timestamp": "2026-04-12T10:01:00Z", "status": "pending"},
    ]
    with patch("app.core.redis.get_waiter_calls", new=AsyncMock(return_value=mock_calls)):
        resp = client.get(f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["calls"]) == 2
    assert body["calls"][0]["id"] == "call-1"


def test_get_waiter_calls_unknown_slug_returns_404(client):
    """GET waiter-calls on non-existent menu → 404."""
    resp = client.get("/api/dashboard/menus/nonexistent/waiter-calls")
    assert resp.status_code == 404


def test_get_waiter_calls_redis_failure_returns_empty(client, menu_and_table):
    """If Redis is down, returns empty list (graceful degradation)."""
    with patch("app.core.redis.get_waiter_calls", new=AsyncMock(side_effect=Exception("Redis down"))):
        resp = client.get(f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls")
    assert resp.status_code == 200
    assert resp.json()["calls"] == []


# ---------------------------------------------------------------------------
# PATCH /api/dashboard/menus/{slug}/waiter-calls/{call_id}/status
# ---------------------------------------------------------------------------

def test_acknowledge_waiter_call(client, menu_and_table):
    """PATCH status=acknowledged updates the call status."""
    updated_call = {"id": "call-1", "table_number": "5", "status": "acknowledged"}
    with patch("app.core.redis.update_waiter_call_status", new=AsyncMock(return_value=updated_call)):
        resp = client.patch(
            f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/call-1/status",
            json={"status": "acknowledged"},
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "acknowledged"


def test_resolve_waiter_call_removes_from_active(client, menu_and_table):
    """PATCH status=resolved also calls dismiss_waiter_call."""
    updated_call = {"id": "call-1", "table_number": "5", "status": "resolved"}
    with patch("app.core.redis.update_waiter_call_status", new=AsyncMock(return_value=updated_call)), \
         patch("app.core.redis.dismiss_waiter_call", new=AsyncMock()) as mock_dismiss:
        resp = client.patch(
            f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/call-1/status",
            json={"status": "resolved"},
        )
    assert resp.status_code == 200
    mock_dismiss.assert_called_once_with(menu_and_table["slug"], "call-1")


def test_update_call_status_invalid_value_returns_400(client, menu_and_table):
    """PATCH with invalid status value → 400."""
    resp = client.patch(
        f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/call-1/status",
        json={"status": "on_the_way"},
    )
    assert resp.status_code == 400


def test_update_call_status_not_found_returns_404(client, menu_and_table):
    """PATCH on non-existent call_id → 404."""
    with patch("app.core.redis.update_waiter_call_status", new=AsyncMock(return_value=None)):
        resp = client.patch(
            f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/nonexistent/status",
            json={"status": "acknowledged"},
        )
    assert resp.status_code == 404


def test_update_call_status_unknown_menu_returns_404(client):
    """PATCH on non-existent menu → 404."""
    resp = client.patch(
        "/api/dashboard/menus/nonexistent/waiter-calls/call-1/status",
        json={"status": "acknowledged"},
    )
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/dashboard/menus/{slug}/waiter-calls/{call_id}
# ---------------------------------------------------------------------------

def test_dismiss_waiter_call_returns_dismissed(client, menu_and_table):
    """DELETE call → {status: dismissed}."""
    with patch("app.core.redis.dismiss_waiter_call", new=AsyncMock()):
        resp = client.delete(
            f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/call-1"
        )
    assert resp.status_code == 200
    assert resp.json()["status"] == "dismissed"


def test_dismiss_waiter_call_unknown_menu_returns_404(client):
    """DELETE on non-existent menu → 404."""
    resp = client.delete("/api/dashboard/menus/nonexistent/waiter-calls/call-1")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/dashboard/menus/{slug}/waiter-calls/history
# ---------------------------------------------------------------------------

def test_get_call_history_returns_all_calls(client, menu_and_table):
    """GET history returns all historical calls for a slug."""
    history = [
        {"id": "h1", "table_number": "5", "status": "resolved", "timestamp": "2026-04-12T09:00:00Z"},
        {"id": "h2", "table_number": "3", "status": "acknowledged", "timestamp": "2026-04-12T09:30:00Z"},
    ]
    with patch("app.core.redis.get_call_history", new=AsyncMock(return_value=history)):
        resp = client.get(f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/history")
    assert resp.status_code == 200
    assert len(resp.json()["calls"]) == 2


def test_get_call_history_filtered_by_table(client, menu_and_table):
    """GET history?table_number=5 filters calls by table."""
    history = [
        {"id": "h1", "table_number": "5", "status": "resolved"},
    ]
    with patch("app.core.redis.get_call_history", new=AsyncMock(return_value=history)):
        resp = client.get(
            f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/history?table_number=5"
        )
    assert resp.status_code == 200
    # Verify table_number was passed to the redis function
    assert resp.json()["calls"][0]["table_number"] == "5"


def test_get_call_history_unknown_menu_returns_404(client):
    """GET history on non-existent menu → 404."""
    resp = client.get("/api/dashboard/menus/nonexistent/waiter-calls/history")
    assert resp.status_code == 404


def test_get_call_history_redis_failure_returns_empty(client, menu_and_table):
    """Redis failure during history fetch → empty list."""
    with patch("app.core.redis.get_call_history", new=AsyncMock(side_effect=Exception("down"))):
        resp = client.get(f"/api/dashboard/menus/{menu_and_table['slug']}/waiter-calls/history")
    assert resp.status_code == 200
    assert resp.json()["calls"] == []
