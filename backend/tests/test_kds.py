"""
Tests for KDS (Kitchen Display System) endpoints:
  GET   /api/v1/kds/{slug}/orders               — list active orders (requires token)
  PATCH /api/v1/kds/{slug}/orders/{id}/status   — update order status (requires token)
  WS    /api/v1/ws/kds/{slug}?token=<token>     — WebSocket connection
"""

import json
import pytest
from unittest.mock import AsyncMock, patch

from app.models import Menu, Order
from tests.conftest import seed_menu


KDS_TOKEN = "kds-dev-token-change-in-production"  # matches config.py default


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def seed_order(
    test_db,
    menu_slug: str,
    status: str = "pending",
    items: list | None = None,
) -> int:
    session = test_db()
    order = Order(
        menu_slug=menu_slug,
        items=items or [{"name": "Steak", "price": 24.0, "quantity": 1}],
        total=2400,
        currency="eur",
        status=status,
    )
    session.add(order)
    session.commit()
    order_id = order.id
    session.close()
    return order_id


def seed_menu_and_order(test_db, slug: str, order_status: str = "pending") -> tuple[int, int]:
    menu_id = seed_menu(test_db, slug=slug)
    order_id = seed_order(test_db, menu_slug=slug, status=order_status)
    return menu_id, order_id


# ---------------------------------------------------------------------------
# GET /api/v1/kds/{slug}/orders — auth
# ---------------------------------------------------------------------------

def test_list_orders_no_token_returns_401(client, test_db):
    """Missing token → 401 Unauthorized."""
    seed_menu(test_db, slug="kds-no-token")
    resp = client.get("/api/v1/kds/kds-no-token/orders")
    assert resp.status_code == 401


def test_list_orders_wrong_token_returns_401(client, test_db):
    """Wrong token → 401."""
    seed_menu(test_db, slug="kds-wrong-token")
    resp = client.get("/api/v1/kds/kds-wrong-token/orders?token=wrong-secret")
    assert resp.status_code == 401


def test_list_orders_valid_token_returns_200(client, test_db):
    """Valid token → 200 with orders list."""
    seed_menu(test_db, slug="kds-valid")
    resp = client.get(f"/api/v1/kds/kds-valid/orders?token={KDS_TOKEN}")
    assert resp.status_code == 200
    assert "orders" in resp.json()


def test_list_orders_unknown_slug_returns_404(client, test_db):
    """Valid token but unknown slug → 404."""
    resp = client.get(f"/api/v1/kds/nonexistent-restaurant/orders?token={KDS_TOKEN}")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/v1/kds/{slug}/orders — data
# ---------------------------------------------------------------------------

def test_list_orders_returns_active_orders_only(client, test_db):
    """Only non-done, non-cancelled orders are returned."""
    slug = "kds-filter-test"
    seed_menu(test_db, slug=slug)
    seed_order(test_db, menu_slug=slug, status="pending")
    seed_order(test_db, menu_slug=slug, status="in_progress")
    seed_order(test_db, menu_slug=slug, status="done")
    seed_order(test_db, menu_slug=slug, status="cancelled")

    resp = client.get(f"/api/v1/kds/{slug}/orders?token={KDS_TOKEN}")
    assert resp.status_code == 200
    orders = resp.json()["orders"]
    # Only pending + in_progress should be returned (2 active)
    assert len(orders) == 2
    statuses = {o["status"] for o in orders}
    assert "done" not in statuses
    assert "cancelled" not in statuses


def test_list_orders_empty_when_all_done(client, test_db):
    """When all orders are done/cancelled, returns empty list."""
    slug = "kds-all-done"
    seed_menu(test_db, slug=slug)
    seed_order(test_db, menu_slug=slug, status="done")
    seed_order(test_db, menu_slug=slug, status="cancelled")

    resp = client.get(f"/api/v1/kds/{slug}/orders?token={KDS_TOKEN}")
    assert resp.json()["orders"] == []


def test_list_orders_includes_elapsed_seconds(client, test_db):
    """Each order includes elapsed_seconds and is_overdue fields."""
    slug = "kds-elapsed"
    seed_menu(test_db, slug=slug)
    seed_order(test_db, menu_slug=slug)

    resp = client.get(f"/api/v1/kds/{slug}/orders?token={KDS_TOKEN}")
    order = resp.json()["orders"][0]
    assert "elapsed_seconds" in order
    assert "is_overdue" in order


def test_list_orders_includes_items(client, test_db):
    """Each order includes its items list."""
    slug = "kds-items-check"
    seed_menu(test_db, slug=slug)
    seed_order(test_db, menu_slug=slug, items=[{"name": "Pizza", "price": 12.0, "quantity": 2}])

    resp = client.get(f"/api/v1/kds/{slug}/orders?token={KDS_TOKEN}")
    order = resp.json()["orders"][0]
    assert order["items"][0]["name"] == "Pizza"


# ---------------------------------------------------------------------------
# PATCH /api/v1/kds/{slug}/orders/{id}/status — auth
# ---------------------------------------------------------------------------

def test_update_status_no_token_returns_401(client, test_db):
    """No token → 401."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-patch-noauth")
    resp = client.patch(
        f"/api/v1/kds/kds-patch-noauth/orders/{order_id}/status",
        json={"status": "in_progress"},
    )
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# PATCH /api/v1/kds/{slug}/orders/{id}/status — transitions
# ---------------------------------------------------------------------------

def test_update_status_to_in_progress(client, test_db):
    """PATCH updates status from pending → in_progress."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-status-1")
    resp = client.patch(
        f"/api/v1/kds/kds-status-1/orders/{order_id}/status?token={KDS_TOKEN}",
        json={"status": "in_progress"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "in_progress"


def test_update_status_to_ready(client, test_db):
    """PATCH updates status to ready."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-status-2")
    resp = client.patch(
        f"/api/v1/kds/kds-status-2/orders/{order_id}/status?token={KDS_TOKEN}",
        json={"status": "ready"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ready"


def test_update_status_to_done(client, test_db):
    """PATCH updates status to done."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-status-3")
    resp = client.patch(
        f"/api/v1/kds/kds-status-3/orders/{order_id}/status?token={KDS_TOKEN}",
        json={"status": "done"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "done"


def test_update_status_persists_to_db(client, test_db):
    """Status change is persisted to the database."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-db-persist")
    client.patch(
        f"/api/v1/kds/kds-db-persist/orders/{order_id}/status?token={KDS_TOKEN}",
        json={"status": "confirmed"},
    )
    session = test_db()
    order = session.query(Order).filter(Order.id == order_id).first()
    session.close()
    assert order.status == "confirmed"


def test_update_status_invalid_status_returns_400(client, test_db):
    """Invalid status value → 400."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-bad-status")
    resp = client.patch(
        f"/api/v1/kds/kds-bad-status/orders/{order_id}/status?token={KDS_TOKEN}",
        json={"status": "flying"},
    )
    assert resp.status_code == 400


def test_update_status_not_found_returns_404(client, test_db):
    """Non-existent order_id → 404."""
    seed_menu(test_db, slug="kds-notfound")
    resp = client.patch(
        f"/api/v1/kds/kds-notfound/orders/99999/status?token={KDS_TOKEN}",
        json={"status": "done"},
    )
    assert resp.status_code == 404


def test_update_done_order_stays_done(client, test_db):
    """Updating a done order silently keeps it done (terminal state)."""
    _, order_id = seed_menu_and_order(test_db, slug="kds-terminal", order_status="done")
    resp = client.patch(
        f"/api/v1/kds/kds-terminal/orders/{order_id}/status?token={KDS_TOKEN}",
        json={"status": "in_progress"},
    )
    assert resp.status_code == 200
    # Terminal state: DB should still be 'done'
    session = test_db()
    order = session.query(Order).filter(Order.id == order_id).first()
    session.close()
    assert order.status == "done"


# ---------------------------------------------------------------------------
# WebSocket — /api/v1/ws/kds/{slug}
# ---------------------------------------------------------------------------

def test_ws_rejects_missing_token(client, test_db):
    """WebSocket without token is rejected (server closes with 4401)."""
    from starlette.websockets import WebSocketDisconnect

    seed_menu(test_db, slug="ws-no-token")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws/kds/ws-no-token"):
            pass


def test_ws_rejects_wrong_token(client, test_db):
    """WebSocket with wrong token is rejected."""
    from starlette.websockets import WebSocketDisconnect

    seed_menu(test_db, slug="ws-wrong-token")
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/v1/ws/kds/ws-wrong-token?token=bad-token"):
            pass


def test_ws_connects_with_valid_token(client, test_db):
    """WebSocket with valid token receives initial snapshot.

    Patches kds.SessionLocal so the WS handler uses the test DB.
    """
    slug = "ws-valid-connect"
    seed_menu(test_db, slug=slug)
    seed_order(test_db, menu_slug=slug, status="pending")

    # kds_websocket uses SessionLocal directly (not get_db DI) — patch it.
    with patch("app.db.SessionLocal", test_db):
        with client.websocket_connect(f"/api/v1/ws/kds/{slug}?token={KDS_TOKEN}") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "snapshot"
            assert "orders" in msg
            assert len(msg["orders"]) == 1


def test_ws_snapshot_excludes_done_orders(client, test_db):
    """Initial snapshot only includes active (non-done) orders."""
    slug = "ws-snapshot-filter"
    seed_menu(test_db, slug=slug)
    seed_order(test_db, menu_slug=slug, status="pending")
    seed_order(test_db, menu_slug=slug, status="done")

    with patch("app.db.SessionLocal", test_db):
        with client.websocket_connect(f"/api/v1/ws/kds/{slug}?token={KDS_TOKEN}") as ws:
            msg = ws.receive_json()
            assert msg["type"] == "snapshot"
            assert len(msg["orders"]) == 1
            assert msg["orders"][0]["status"] == "pending"


def test_ws_status_update_message(client, test_db):
    """Sending status_update message → server broadcasts updated order."""
    slug = "ws-status-update"
    seed_menu(test_db, slug=slug)
    order_id = seed_order(test_db, menu_slug=slug, status="pending")

    with patch("app.db.SessionLocal", test_db):
        with client.websocket_connect(f"/api/v1/ws/kds/{slug}?token={KDS_TOKEN}") as ws:
            # Consume snapshot
            ws.receive_json()

            # Send status update
            ws.send_json({"type": "status_update", "order_id": order_id, "status": "in_progress"})

            # Receive broadcast
            msg = ws.receive_json()
            assert msg["type"] == "status_update"
            assert msg["order"]["id"] == order_id
            assert msg["order"]["status"] == "in_progress"
