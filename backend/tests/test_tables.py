"""
Tests for tables endpoints:
  POST  /api/v1/tables/bulk           — bulk create N tables with QR tokens
  GET   /api/v1/tables                — list tables for a menu slug
  GET   /api/v1/tables/{id}           — get one table
  GET   /api/v1/tables/{id}/qr        — get QR code PNG
  PATCH /api/v1/tables/{id}           — update table fields including status
  DELETE /api/v1/tables/{id}          — soft-delete
  GET   /api/v1/tables/export/qr-pdf  — download PDF
"""

import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Table


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


def _bulk_create(client, menu_slug="le-resto", count=5, start_at=1, zone=None):
    body = {"menu_slug": menu_slug, "restaurant_id": "org_123", "count": count, "start_at": start_at}
    if zone:
        body["zone"] = zone
    return client.post("/api/v1/tables/bulk", json=body)


# ---------------------------------------------------------------------------
# POST /bulk — bulk table creation
# ---------------------------------------------------------------------------

def test_bulk_create_10_tables(client):
    """Bulk create 10 tables numbered 1-10 with unique QR tokens."""
    resp = _bulk_create(client, count=10)
    assert resp.status_code == 201
    tables = resp.json()
    assert len(tables) == 10


def test_bulk_create_numbers_sequentially(client):
    """Tables are numbered start_at to start_at+count-1."""
    resp = _bulk_create(client, count=5, start_at=1)
    tables = resp.json()
    numbers = [t["number"] for t in tables]
    assert numbers == ["1", "2", "3", "4", "5"]


def test_bulk_create_custom_start_at(client):
    """start_at=10 creates tables numbered 10-14."""
    resp = _bulk_create(client, count=5, start_at=10)
    tables = resp.json()
    assert tables[0]["number"] == "10"
    assert tables[4]["number"] == "14"


def test_bulk_create_each_table_has_unique_qr_token(client):
    """Each table gets a unique UUID v4 QR token."""
    resp = _bulk_create(client, count=10)
    tokens = [t["qr_token"] for t in resp.json()]
    assert len(set(tokens)) == 10  # all unique


def test_bulk_create_tables_have_qr_url(client):
    """Each table response includes a qr_url pointing to /api/v1/tables/{id}/qr."""
    resp = _bulk_create(client, count=3)
    for t in resp.json():
        assert "/api/v1/tables/" in t["qr_url"]
        assert t["qr_url"].endswith("/qr")


def test_bulk_create_with_zone_sets_label(client):
    """Tables created with zone get that zone as their label."""
    resp = _bulk_create(client, count=3, zone="Terrasse")
    for t in resp.json():
        assert t["label"] == "Terrasse"


def test_bulk_create_count_zero_returns_400(client):
    """count=0 → 400."""
    resp = client.post("/api/v1/tables/bulk", json={"menu_slug": "test", "restaurant_id": "r", "count": 0})
    assert resp.status_code == 400


def test_bulk_create_count_over_200_returns_400(client):
    """count=201 → 400."""
    resp = client.post("/api/v1/tables/bulk", json={"menu_slug": "test", "restaurant_id": "r", "count": 201})
    assert resp.status_code == 400


def test_bulk_create_persists_to_db(client, test_db):
    """Tables are persisted in DB after bulk create."""
    _bulk_create(client, menu_slug="persistance-test", count=3)

    session = test_db()
    tables = session.query(Table).filter(Table.menu_slug == "persistance-test").all()
    session.close()
    assert len(tables) == 3


# ---------------------------------------------------------------------------
# GET / — list tables
# ---------------------------------------------------------------------------

def test_list_tables_returns_only_active(client, test_db):
    """GET /tables?menu_slug=... returns only active tables by default."""
    _bulk_create(client, menu_slug="list-test", count=5)

    # Soft-delete one table
    session = test_db()
    table = session.query(Table).filter(Table.menu_slug == "list-test").first()
    table.is_active = False
    session.commit()
    session.close()

    resp = client.get("/api/v1/tables?menu_slug=list-test")
    assert resp.status_code == 200
    assert len(resp.json()) == 4  # 5 created, 1 deleted


def test_list_tables_include_inactive(client, test_db):
    """GET /tables?include_inactive=true returns all tables."""
    _bulk_create(client, menu_slug="all-tables-test", count=4)

    session = test_db()
    table = session.query(Table).filter(Table.menu_slug == "all-tables-test").first()
    table.is_active = False
    session.commit()
    session.close()

    resp = client.get("/api/v1/tables?menu_slug=all-tables-test&include_inactive=true")
    assert resp.status_code == 200
    assert len(resp.json()) == 4


def test_list_tables_empty_for_unknown_slug(client):
    """GET /tables?menu_slug=nonexistent → empty list."""
    resp = client.get("/api/v1/tables?menu_slug=nonexistent-slug")
    assert resp.status_code == 200
    assert resp.json() == []


# ---------------------------------------------------------------------------
# GET /{table_id} — single table
# ---------------------------------------------------------------------------

def test_get_table_by_id(client, test_db):
    """GET /tables/{id} returns full table data."""
    _bulk_create(client, menu_slug="get-test", count=1)

    session = test_db()
    table = session.query(Table).filter(Table.menu_slug == "get-test").first()
    table_id = table.id
    session.close()

    resp = client.get(f"/api/v1/tables/{table_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == table_id
    assert body["menu_slug"] == "get-test"


def test_get_table_not_found_returns_404(client):
    """GET /tables/99999 → 404."""
    resp = client.get("/api/v1/tables/99999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /{table_id}/qr — QR code image
# ---------------------------------------------------------------------------

def test_get_qr_returns_png(client, test_db):
    """GET /tables/{id}/qr returns image/png response."""
    _bulk_create(client, menu_slug="qr-test", count=1)
    session = test_db()
    table = session.query(Table).filter(Table.menu_slug == "qr-test").first()
    table_id = table.id
    session.close()

    resp = client.get(f"/api/v1/tables/{table_id}/qr")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "image/png"
    assert len(resp.content) > 100  # PNG has actual bytes


def test_get_qr_not_found_returns_404(client):
    """GET /tables/99999/qr → 404."""
    resp = client.get("/api/v1/tables/99999/qr")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /{table_id} — update table
# ---------------------------------------------------------------------------

def test_patch_table_updates_label(client, test_db):
    """PATCH /tables/{id} updates the label field."""
    _bulk_create(client, menu_slug="patch-test", count=1)
    session = test_db()
    table_id = session.query(Table).filter(Table.menu_slug == "patch-test").first().id
    session.close()

    resp = client.patch(f"/api/v1/tables/{table_id}", json={"label": "Bar"})
    assert resp.status_code == 200
    assert resp.json()["label"] == "Bar"


def test_patch_table_updates_capacity(client, test_db):
    """PATCH /tables/{id} updates capacity."""
    _bulk_create(client, menu_slug="cap-test", count=1)
    session = test_db()
    table_id = session.query(Table).filter(Table.menu_slug == "cap-test").first().id
    session.close()

    resp = client.patch(f"/api/v1/tables/{table_id}", json={"capacity": 8})
    assert resp.status_code == 200
    assert resp.json()["capacity"] == 8


def test_patch_table_updates_status(client, test_db):
    """PATCH /tables/{id} with status updates table status."""
    _bulk_create(client, menu_slug="status-test", count=1)
    session = test_db()
    table_id = session.query(Table).filter(Table.menu_slug == "status-test").first().id
    session.close()

    resp = client.patch(f"/api/v1/tables/{table_id}", json={"status": "occupied"})
    assert resp.status_code == 200
    assert resp.json()["status"] == "occupied"


def test_patch_table_status_cycles(client, test_db):
    """Status can be set to occupied, reserved, or available."""
    _bulk_create(client, menu_slug="status-cycle", count=1)
    session = test_db()
    table_id = session.query(Table).filter(Table.menu_slug == "status-cycle").first().id
    session.close()

    for status in ("occupied", "reserved", "available"):
        resp = client.patch(f"/api/v1/tables/{table_id}", json={"status": status})
        assert resp.status_code == 200
        assert resp.json()["status"] == status


def test_patch_table_not_found_returns_404(client):
    """PATCH /tables/99999 → 404."""
    resp = client.patch("/api/v1/tables/99999", json={"label": "Bar"})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /{table_id} — soft delete
# ---------------------------------------------------------------------------

def test_delete_table_sets_is_active_false(client, test_db):
    """DELETE /tables/{id} soft-deletes (is_active=False)."""
    _bulk_create(client, menu_slug="delete-test", count=1)
    session = test_db()
    table_id = session.query(Table).filter(Table.menu_slug == "delete-test").first().id
    session.close()

    resp = client.delete(f"/api/v1/tables/{table_id}")
    assert resp.status_code == 204

    session = test_db()
    table = session.query(Table).filter(Table.id == table_id).first()
    session.close()
    assert table.is_active is False


# ---------------------------------------------------------------------------
# GET /export/qr-pdf — PDF export
# ---------------------------------------------------------------------------

def test_export_qr_pdf_returns_pdf(client, test_db):
    """GET /tables/export/qr-pdf returns application/pdf."""
    _bulk_create(client, menu_slug="pdf-export-test", count=6)

    resp = client.get("/api/v1/tables/export/qr-pdf?menu_slug=pdf-export-test&restaurant_name=Test+Resto")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    assert len(resp.content) > 500  # actual PDF bytes


def test_export_qr_pdf_no_tables_returns_404(client):
    """GET /tables/export/qr-pdf for slug with no tables → 404."""
    resp = client.get("/api/v1/tables/export/qr-pdf?menu_slug=empty-slug")
    assert resp.status_code == 404
