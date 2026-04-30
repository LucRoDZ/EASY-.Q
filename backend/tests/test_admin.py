"""
Tests for admin backoffice endpoints (all require admin JWT):
  GET   /api/v1/admin/stats
  GET   /api/v1/admin/restaurants
  PATCH /api/v1/admin/restaurants/{slug}/status
  GET   /api/v1/admin/subscriptions
  GET   /api/v1/admin/audit-logs
"""

import base64
import json
import pytest
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import AuditLog, Menu, Subscription


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


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_token(user_id: str) -> str:
    """Build a fake JWT with the given sub claim (no real signature — dev mode)."""
    header = base64.urlsafe_b64encode(b'{"alg":"none"}').rstrip(b"=").decode()
    payload_bytes = json.dumps({"sub": user_id}).encode()
    payload = base64.urlsafe_b64encode(payload_bytes).rstrip(b"=").decode()
    return f"{header}.{payload}.fakesig"


ADMIN_ID = "user_admin_test"
NONADMIN_ID = "user_other"


def _admin_headers(monkeypatch) -> dict:
    """Return Authorization header + monkeypatch ADMIN_USER_IDS to include ADMIN_ID."""
    monkeypatch.setattr("app.routers.auth.ADMIN_USER_IDS", [ADMIN_ID])
    monkeypatch.setattr("app.routers.auth.CLERK_JWKS_URL", "")
    return {"Authorization": f"Bearer {_make_token(ADMIN_ID)}"}


def _seed_menu(test_db, slug="bistrot", name="Bistrot", publish_status="published"):
    session = test_db()
    menu = Menu(slug=slug, restaurant_name=name, publish_status=publish_status,
                pdf_path=f"/tmp/{slug}.pdf", menu_data="{}")
    session.add(menu)
    session.commit()
    session.close()


def _seed_subscription(test_db, restaurant_id: str, plan: str = "free",
                        status: str = "active") -> None:
    session = test_db()
    sub = Subscription(restaurant_id=restaurant_id, plan=plan, status=status)
    session.add(sub)
    session.commit()
    session.close()


def _seed_audit_log(test_db, action: str = "test.action",
                    resource_id: str = "slug-test") -> None:
    session = test_db()
    log = AuditLog(
        actor_type="admin",
        actor_id="user_admin_test",
        action=action,
        resource_type="menu",
        resource_id=resource_id,
        payload={},
    )
    session.add(log)
    session.commit()
    session.close()


# ---------------------------------------------------------------------------
# Auth guard tests (all endpoints should reject unauthenticated requests)
# ---------------------------------------------------------------------------


class TestAdminAuthGuard:
    def test_stats_no_token_returns_401(self, client):
        resp = client.get("/api/v1/admin/stats")
        assert resp.status_code == 401

    def test_stats_non_admin_returns_403(self, client, monkeypatch):
        monkeypatch.setattr("app.routers.auth.ADMIN_USER_IDS", [ADMIN_ID])
        monkeypatch.setattr("app.routers.auth.CLERK_JWKS_URL", "")
        headers = {"Authorization": f"Bearer {_make_token(NONADMIN_ID)}"}
        resp = client.get("/api/v1/admin/stats", headers=headers)
        assert resp.status_code == 403

    def test_stats_empty_admin_ids_returns_403(self, client, monkeypatch):
        """When ADMIN_USER_IDS is empty, even valid tokens should be denied."""
        monkeypatch.setattr("app.routers.auth.ADMIN_USER_IDS", [])
        monkeypatch.setattr("app.routers.auth.CLERK_JWKS_URL", "")
        headers = {"Authorization": f"Bearer {_make_token(ADMIN_ID)}"}
        resp = client.get("/api/v1/admin/stats", headers=headers)
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# GET /stats
# ---------------------------------------------------------------------------


class TestAdminStats:
    def test_returns_expected_fields(self, client, monkeypatch):
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/stats", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        for field in (
            "total_restaurants", "active_restaurants", "pro_subscriptions",
            "free_subscriptions", "total_revenue_eur", "total_orders", "total_nps_responses"
        ):
            assert field in body, f"Missing field: {field}"

    def test_counts_pro_subscriptions(self, client, test_db, monkeypatch):
        _seed_subscription(test_db, "org-pro", plan="pro", status="active")
        _seed_subscription(test_db, "org-free", plan="free", status="active")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/stats", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["pro_subscriptions"] == 1

    def test_empty_db_returns_zeros(self, client, monkeypatch):
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/stats", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total_restaurants"] == 0
        assert body["total_orders"] == 0
        assert body["total_revenue_eur"] == 0.0


# ---------------------------------------------------------------------------
# GET /restaurants
# ---------------------------------------------------------------------------


class TestAdminRestaurants:
    def test_lists_all_restaurants(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "resto-1", "Resto 1")
        _seed_menu(test_db, "resto-2", "Resto 2")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/restaurants", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2
        assert len(body["restaurants"]) == 2

    def test_filters_by_status_published(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "pub-rest", "Published", publish_status="published")
        _seed_menu(test_db, "draft-rest", "Draft", publish_status="draft")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/restaurants?status=published", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["restaurants"][0]["slug"] == "pub-rest"

    def test_filters_by_plan_pro(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "pro-rest", "Pro Restaurant")
        _seed_menu(test_db, "free-rest", "Free Restaurant")
        _seed_subscription(test_db, "pro-rest", plan="pro")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/restaurants?plan=pro", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["restaurants"][0]["slug"] == "pro-rest"

    def test_response_includes_plan_fields(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "fields-rest", "Fields")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/restaurants", headers=headers)
        assert resp.status_code == 200
        rest = resp.json()["restaurants"][0]
        for field in ("slug", "restaurant_name", "publish_status", "plan"):
            assert field in rest, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# PATCH /restaurants/{slug}/status
# ---------------------------------------------------------------------------


class TestAdminUpdateStatus:
    def test_publish_restaurant(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "toggle-rest", "Toggle", publish_status="draft")
        headers = _admin_headers(monkeypatch)
        resp = client.patch(
            "/api/v1/admin/restaurants/toggle-rest/status",
            json={"status": "published"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["publish_status"] == "published"

    def test_draft_restaurant(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "draft-toggle", "Draft Toggle", publish_status="published")
        headers = _admin_headers(monkeypatch)
        resp = client.patch(
            "/api/v1/admin/restaurants/draft-toggle/status",
            json={"status": "draft"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["publish_status"] == "draft"

    def test_legacy_active_maps_to_published(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "legacy-rest", "Legacy", publish_status="draft")
        headers = _admin_headers(monkeypatch)
        resp = client.patch(
            "/api/v1/admin/restaurants/legacy-rest/status",
            json={"status": "active"},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["publish_status"] == "published"

    def test_invalid_status_returns_400(self, client, test_db, monkeypatch):
        _seed_menu(test_db, "bad-status", "Bad Status")
        headers = _admin_headers(monkeypatch)
        resp = client.patch(
            "/api/v1/admin/restaurants/bad-status/status",
            json={"status": "broken"},
            headers=headers,
        )
        assert resp.status_code == 400

    def test_unknown_restaurant_returns_404(self, client, monkeypatch):
        headers = _admin_headers(monkeypatch)
        resp = client.patch(
            "/api/v1/admin/restaurants/does-not-exist/status",
            json={"status": "published"},
            headers=headers,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /subscriptions
# ---------------------------------------------------------------------------


class TestAdminSubscriptions:
    def test_lists_all_subscriptions(self, client, test_db, monkeypatch):
        _seed_subscription(test_db, "sub-org-1", plan="pro")
        _seed_subscription(test_db, "sub-org-2", plan="free")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/subscriptions", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 2

    def test_filters_by_plan(self, client, test_db, monkeypatch):
        _seed_subscription(test_db, "filter-pro", plan="pro")
        _seed_subscription(test_db, "filter-free", plan="free")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/subscriptions?plan=pro", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["subscriptions"][0]["plan"] == "pro"

    def test_response_has_expected_fields(self, client, test_db, monkeypatch):
        _seed_subscription(test_db, "fields-sub-org", plan="free")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/subscriptions", headers=headers)
        assert resp.status_code == 200
        sub = resp.json()["subscriptions"][0]
        for field in ("id", "restaurant_id", "plan", "status", "stripe_subscription_id"):
            assert field in sub, f"Missing field: {field}"


# ---------------------------------------------------------------------------
# GET /audit-logs
# ---------------------------------------------------------------------------


class TestAdminAuditLogs:
    def test_returns_paginated_logs(self, client, test_db, monkeypatch):
        _seed_audit_log(test_db, action="test.action")
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/audit-logs", headers=headers)
        assert resp.status_code == 200
        body = resp.json()
        assert "logs" in body
        assert "total" in body
        assert body["total"] >= 1

    def test_filters_by_action(self, client, test_db, monkeypatch):
        _seed_audit_log(test_db, action="restaurant.published")
        _seed_audit_log(test_db, action="subscription.created")
        headers = _admin_headers(monkeypatch)
        resp = client.get(
            "/api/v1/admin/audit-logs?action=restaurant.published", headers=headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert all("restaurant" in log["action"] for log in body["logs"])

    def test_filters_by_resource_id(self, client, test_db, monkeypatch):
        _seed_audit_log(test_db, resource_id="my-slug")
        _seed_audit_log(test_db, resource_id="other-slug")
        headers = _admin_headers(monkeypatch)
        resp = client.get(
            "/api/v1/admin/audit-logs?resource_id=my-slug", headers=headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 1
        assert body["logs"][0]["resource_id"] == "my-slug"

    def test_pagination_limit_and_offset(self, client, test_db, monkeypatch):
        for i in range(5):
            _seed_audit_log(test_db, action=f"action.{i}", resource_id=f"r-{i}")
        headers = _admin_headers(monkeypatch)
        resp = client.get(
            "/api/v1/admin/audit-logs?limit=2&offset=0", headers=headers
        )
        assert resp.status_code == 200
        body = resp.json()
        assert len(body["logs"]) == 2
        assert body["total"] >= 5

    def test_response_has_expected_fields(self, client, test_db, monkeypatch):
        _seed_audit_log(test_db)
        headers = _admin_headers(monkeypatch)
        resp = client.get("/api/v1/admin/audit-logs", headers=headers)
        assert resp.status_code == 200
        log = resp.json()["logs"][0]
        for field in ("id", "actor_type", "actor_id", "action", "resource_type",
                      "resource_id", "payload", "created_at"):
            assert field in log, f"Missing field: {field}"
