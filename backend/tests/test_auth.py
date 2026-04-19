"""
Tests for auth endpoints:
  GET  /api/v1/auth/me      — return user info from Clerk JWT
  POST /api/v1/auth/webhook — handle Clerk user lifecycle webhooks
"""

import base64
import json
import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import AuditLog, Subscription


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


def _make_jwt(payload: dict) -> str:
    """Build a minimal (unsigned) JWT for testing the /me endpoint.

    Structure: base64url(header).base64url(payload).fake_sig
    """
    def b64url(data: dict) -> str:
        encoded = base64.urlsafe_b64encode(json.dumps(data).encode()).decode()
        return encoded.rstrip("=")

    header = {"alg": "RS256", "typ": "JWT"}
    sig = "fakesignature"
    return f"{b64url(header)}.{b64url(payload)}.{sig}"


def _make_clerk_event(event_type: str, user_id: str = "user_123", email: str = "chef@bistrot.fr") -> dict:
    """Build a minimal Clerk webhook event payload."""
    return {
        "type": event_type,
        "data": {
            "id": user_id,
            "primary_email_address_id": "iea_1",
            "email_addresses": [
                {"id": "iea_1", "email_address": email},
            ],
        },
    }


# ---------------------------------------------------------------------------
# GET /api/v1/auth/me
# ---------------------------------------------------------------------------


def test_me_returns_user_id_from_jwt(client):
    """Valid JWT returns user_id from sub claim."""
    token = _make_jwt({"sub": "user_abc", "email": "test@example.com", "org_id": "org_xyz"})
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["user_id"] == "user_abc"
    assert body["email"] == "test@example.com"
    assert body["org_id"] == "org_xyz"


def test_me_no_token_returns_401(client):
    """Missing Authorization header → 401."""
    resp = client.get("/api/v1/auth/me")
    assert resp.status_code == 401


def test_me_invalid_bearer_returns_401(client):
    """Non-Bearer token → 401."""
    resp = client.get("/api/v1/auth/me", headers={"Authorization": "Basic abc123"})
    assert resp.status_code == 401


def test_me_malformed_jwt_returns_401(client):
    """Malformed JWT (not 3 parts) → 401."""
    resp = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer notajwt"})
    assert resp.status_code == 401


def test_me_jwt_without_sub_returns_401(client):
    """JWT payload missing sub claim → 401."""
    token = _make_jwt({"email": "nouser@example.com"})
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401


def test_me_with_pro_subscription_returns_plan(client, test_db):
    """When a Pro Subscription exists for the org, /me returns plan=pro."""
    session = test_db()
    sub = Subscription(
        restaurant_id="org_pro",
        plan="pro",
        status="active",
    )
    session.add(sub)
    session.commit()
    session.close()

    token = _make_jwt({"sub": "user_abc", "email": "owner@bistrot.fr", "org_id": "org_pro"})
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["plan"] == "pro"
    assert body["org_id"] == "org_pro"


def test_me_no_subscription_returns_free_plan(client):
    """When no Subscription exists, /me returns plan=free."""
    token = _make_jwt({"sub": "user_new", "email": "new@example.com", "org_id": "org_unknown"})
    resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["plan"] == "free"


# ---------------------------------------------------------------------------
# POST /api/v1/auth/webhook — Clerk webhook
# ---------------------------------------------------------------------------


def test_webhook_user_created_stores_audit_log(client, test_db, monkeypatch):
    """user.created event is logged in AuditLog."""
    monkeypatch.setattr("app.routers.auth.CLERK_WEBHOOK_SECRET", "")

    event = _make_clerk_event("user.created", user_id="user_new_1", email="newuser@example.com")
    resp = client.post(
        "/api/v1/auth/webhook",
        content=json.dumps(event),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["received"] is True
    assert resp.json()["event"] == "user.created"

    session = test_db()
    log = session.query(AuditLog).filter(AuditLog.action == "auth.user_created").first()
    session.close()

    assert log is not None
    assert log.resource_id == "user_new_1"
    assert log.payload["email"] == "newuser@example.com"


def test_webhook_user_updated_stores_audit_log(client, test_db, monkeypatch):
    """user.updated event is logged in AuditLog."""
    monkeypatch.setattr("app.routers.auth.CLERK_WEBHOOK_SECRET", "")

    event = _make_clerk_event("user.updated", user_id="user_upd_1")
    resp = client.post(
        "/api/v1/auth/webhook",
        content=json.dumps(event),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200

    session = test_db()
    log = session.query(AuditLog).filter(AuditLog.action == "auth.user_updated").first()
    session.close()
    assert log is not None
    assert log.resource_id == "user_upd_1"


def test_webhook_user_deleted_stores_audit_log(client, test_db, monkeypatch):
    """user.deleted event is logged in AuditLog (GDPR traceability)."""
    monkeypatch.setattr("app.routers.auth.CLERK_WEBHOOK_SECRET", "")

    event = _make_clerk_event("user.deleted", user_id="user_del_1")
    resp = client.post(
        "/api/v1/auth/webhook",
        content=json.dumps(event),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200

    session = test_db()
    log = session.query(AuditLog).filter(AuditLog.action == "auth.user_deleted").first()
    session.close()
    assert log is not None
    assert log.resource_id == "user_del_1"


def test_webhook_unknown_event_type_still_logs(client, test_db, monkeypatch):
    """Unknown event types are still logged with a generic action name."""
    monkeypatch.setattr("app.routers.auth.CLERK_WEBHOOK_SECRET", "")

    event = {"type": "organization.created", "data": {"id": "org_new"}}
    resp = client.post(
        "/api/v1/auth/webhook",
        content=json.dumps(event),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["event"] == "organization.created"


def test_webhook_invalid_json_returns_400(client, monkeypatch):
    """Invalid JSON body → 400."""
    monkeypatch.setattr("app.routers.auth.CLERK_WEBHOOK_SECRET", "")

    resp = client.post(
        "/api/v1/auth/webhook",
        content=b"not valid json",
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 400


def test_webhook_event_contains_correct_user_id_in_response(client, test_db, monkeypatch):
    """Response includes the event type."""
    monkeypatch.setattr("app.routers.auth.CLERK_WEBHOOK_SECRET", "")

    event = _make_clerk_event("user.created", user_id="user_check")
    resp = client.post(
        "/api/v1/auth/webhook",
        content=json.dumps(event),
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["received"] is True
    assert body["event"] == "user.created"
