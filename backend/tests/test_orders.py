"""
Tests for orders endpoints:
  POST  /api/v1/orders                      — create order (dine-in + takeout)
  GET   /api/v1/orders/{id}                 — get order, auto-lock after 2min
  PATCH /api/v1/orders/{id}                 — edit within window, 409 if locked
  PATCH /api/v1/orders/{id}/status          — KDS status advance
  GET   /api/v1/orders/by-table/{token}     — list by table

Also covers:
  - Multiple concurrent orders (KDS scenario)
  - Scan & Go flow (no table_token → pickup number generated)
  - Edit window enforcement (2-minute lock)
"""

import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Order, Table


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
def client(test_db):
    return TestClient(app)


@pytest.fixture
def db_session(test_db):
    db = test_db()
    yield db
    db.close()


@pytest.fixture
def table_with_qr(db_session):
    """Create a table with a known QR token."""
    table = Table(
        menu_slug="test-resto",
        restaurant_id="org_test",
        number=1,
        label="Table 1",
        qr_token="tok-abc123",
        is_active=True,
    )
    db_session.add(table)
    db_session.commit()
    db_session.refresh(table)
    return table


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _order_body(menu_slug="test-resto", table_token=None, items=None, notes=None):
    return {
        "menu_slug": menu_slug,
        "table_token": table_token,
        "items": items or [
            {"name": "Entrecôte", "quantity": 1, "price": 18.50},
            {"name": "Verre de vin", "quantity": 2, "price": 6.00},
        ],
        "currency": "eur",
        "notes": notes,
    }


# ---------------------------------------------------------------------------
# POST /api/v1/orders — dine-in order
# ---------------------------------------------------------------------------

def test_create_order_dine_in(client, table_with_qr):
    body = _order_body(table_token="tok-abc123")
    res = client.post("/api/v1/orders", json=body)
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "pending"
    assert data["table_token"] == "tok-abc123"
    assert data["pickup_number"] is None
    # Total: 18.50 + 2*6.00 = 30.50 → 3050 cents
    assert data["total"] == 3050
    assert data["seconds_remaining"] is not None
    assert data["seconds_remaining"] > 100  # freshly created


def test_create_order_unknown_table_returns_404(client):
    body = _order_body(table_token="nonexistent-token")
    res = client.post("/api/v1/orders", json=body)
    assert res.status_code == 404


# ---------------------------------------------------------------------------
# Scan & Go — no table_token → pickup number
# ---------------------------------------------------------------------------

def test_scan_and_go_generates_pickup_number(client):
    """Takeout order (no table) must receive a pickup number starting at 1."""
    body = _order_body(table_token=None)
    res = client.post("/api/v1/orders", json=body)
    assert res.status_code == 201
    data = res.json()
    assert data["table_token"] is None
    assert data["pickup_number"] == 1


def test_scan_and_go_increments_pickup_number(client):
    """Second takeout order for same slug must get pickup #2."""
    body = _order_body(menu_slug="scan-go-resto", table_token=None, items=[
        {"name": "Burger", "quantity": 1, "price": 12.00},
    ])
    res1 = client.post("/api/v1/orders", json=body)
    res2 = client.post("/api/v1/orders", json=body)
    assert res1.status_code == 201
    assert res2.status_code == 201
    assert res1.json()["pickup_number"] == 1
    assert res2.json()["pickup_number"] == 2


def test_scan_and_go_different_slugs_independent_counters(client):
    """Each restaurant slug has its own pickup counter."""
    body_a = _order_body(menu_slug="resto-a", table_token=None)
    body_b = _order_body(menu_slug="resto-b", table_token=None)
    r1 = client.post("/api/v1/orders", json=body_a)
    r2 = client.post("/api/v1/orders", json=body_b)
    r3 = client.post("/api/v1/orders", json=body_a)
    assert r1.json()["pickup_number"] == 1
    assert r2.json()["pickup_number"] == 1   # independent counter
    assert r3.json()["pickup_number"] == 2


# ---------------------------------------------------------------------------
# KDS — multiple concurrent orders
# ---------------------------------------------------------------------------

def test_kds_multiple_concurrent_orders(client, table_with_qr):
    """Simulate multiple orders arriving concurrently; all appear with status=pending."""
    orders_data = [
        _order_body(table_token="tok-abc123", items=[
            {"name": f"Plat {i}", "quantity": 1, "price": float(10 + i)},
        ])
        for i in range(5)
    ]

    created_ids = []
    for body in orders_data:
        res = client.post("/api/v1/orders", json=body)
        assert res.status_code == 201
        created_ids.append(res.json()["id"])

    assert len(set(created_ids)) == 5  # all unique IDs

    # Each order should be retrievable with status=pending
    for order_id in created_ids:
        res = client.get(f"/api/v1/orders/{order_id}")
        assert res.status_code == 200
        assert res.json()["status"] == "pending"


def test_kds_advance_order_through_statuses(client, table_with_qr):
    """KDS can advance an order through all stages."""
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]

    for expected_status in ("confirmed", "in_progress", "ready", "done"):
        res = client.patch(
            f"/api/v1/orders/{order_id}/status",
            params={"status": expected_status},
        )
        assert res.status_code == 200
        assert res.json()["status"] == expected_status


def test_kds_cannot_modify_done_order(client, table_with_qr):
    """Once an order is 'done', status cannot be changed."""
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]
    client.patch(f"/api/v1/orders/{order_id}/status", params={"status": "done"})

    res = client.patch(
        f"/api/v1/orders/{order_id}/status",
        params={"status": "in_progress"},
    )
    assert res.status_code == 409


def test_kds_invalid_status_returns_400(client, table_with_qr):
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]
    res = client.patch(
        f"/api/v1/orders/{order_id}/status",
        params={"status": "flying"},
    )
    assert res.status_code == 400


# ---------------------------------------------------------------------------
# Order edit window (2-minute lock)
# ---------------------------------------------------------------------------

def test_edit_within_window_succeeds(client, table_with_qr):
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]

    res = client.patch(f"/api/v1/orders/{order_id}", json={
        "items": [{"name": "Salade", "quantity": 1, "price": 9.00}],
        "notes": "sans oignons",
    })
    assert res.status_code == 200
    data = res.json()
    assert data["total"] == 900
    assert data["notes"] == "sans oignons"


def test_edit_after_window_returns_409(client, table_with_qr, db_session):
    """An order created > 2 minutes ago cannot be edited."""
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]

    # Backdate created_at to 3 minutes ago
    old_time = datetime.now(timezone.utc) - timedelta(minutes=3)
    db_session.query(Order).filter(Order.id == order_id).update(
        {"created_at": old_time.replace(tzinfo=None)}
    )
    db_session.commit()

    res = client.patch(f"/api/v1/orders/{order_id}", json={
        "items": [{"name": "Pizza", "quantity": 1, "price": 14.00}],
    })
    assert res.status_code == 409


def test_get_order_returns_seconds_remaining(client, table_with_qr):
    """Fresh order must expose seconds_remaining between 1 and 120."""
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]

    res = client.get(f"/api/v1/orders/{order_id}")
    data = res.json()
    assert data["seconds_remaining"] is not None
    assert 1 <= data["seconds_remaining"] <= 120


def test_get_order_locked_has_no_seconds_remaining(client, table_with_qr, db_session):
    """After confirming an order, seconds_remaining must be None."""
    res = client.post("/api/v1/orders", json=_order_body(table_token="tok-abc123"))
    order_id = res.json()["id"]

    # Manually confirm the order
    client.patch(f"/api/v1/orders/{order_id}/status", params={"status": "confirmed"})

    res = client.get(f"/api/v1/orders/{order_id}")
    assert res.json()["seconds_remaining"] is None


# ---------------------------------------------------------------------------
# GET /api/v1/orders/by-table/{token}
# ---------------------------------------------------------------------------

def test_list_orders_by_table(client, table_with_qr):
    """Two orders for the same table should both be returned."""
    body = _order_body(table_token="tok-abc123")
    client.post("/api/v1/orders", json=body)
    client.post("/api/v1/orders", json=body)

    res = client.get("/api/v1/orders/by-table/tok-abc123")
    assert res.status_code == 200
    orders = res.json()
    assert len(orders) == 2


def test_list_orders_by_table_empty(client):
    res = client.get("/api/v1/orders/by-table/nonexistent-tok")
    assert res.status_code == 200
    assert res.json() == []


# ---------------------------------------------------------------------------
# GET /api/v1/orders/{id} — not found
# ---------------------------------------------------------------------------

def test_get_nonexistent_order_returns_404(client):
    res = client.get("/api/v1/orders/99999")
    assert res.status_code == 404
