"""
Tests for subscription management endpoints:
  GET  /api/v1/subscriptions/{restaurant_id}  — get/create subscription
  POST /api/v1/subscriptions/create-checkout  — Stripe Checkout (mocked)
  POST /api/v1/subscriptions/portal           — Stripe Portal (mocked)
  POST /api/v1/subscriptions/webhook          — billing webhook handler
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
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


def _seed_subscription(test_db, restaurant_id: str, plan: str = "free",
                        status: str = "active",
                        stripe_sub_id: str | None = None) -> None:
    session = test_db()
    sub = Subscription(
        restaurant_id=restaurant_id,
        plan=plan,
        status=status,
        stripe_subscription_id=stripe_sub_id,
    )
    session.add(sub)
    session.commit()
    session.close()


def _stripe_subscription_event(
    event_type: str,
    restaurant_id: str,
    stripe_status: str = "active",
    stripe_sub_id: str = "sub_test_123",
    period_end: int = 1800000000,
) -> dict:
    """Build a minimal Stripe billing webhook event payload."""
    return {
        "type": event_type,
        "data": {
            "object": {
                "id": stripe_sub_id,
                "status": stripe_status,
                "metadata": {"restaurant_id": restaurant_id},
                "current_period_end": period_end,
            }
        },
    }


# ---------------------------------------------------------------------------
# GET /{restaurant_id} — get or auto-create subscription
# ---------------------------------------------------------------------------

class TestGetSubscription:
    def test_auto_creates_free_subscription_for_new_restaurant(self, client):
        resp = client.get("/api/v1/subscriptions/new-restaurant-xyz")
        assert resp.status_code == 200
        body = resp.json()
        assert body["restaurant_id"] == "new-restaurant-xyz"
        assert body["plan"] == "free"
        assert body["status"] == "active"

    def test_returns_existing_pro_subscription(self, client, test_db):
        _seed_subscription(test_db, "pro-restaurant", plan="pro", stripe_sub_id="sub_abc")
        resp = client.get("/api/v1/subscriptions/pro-restaurant")
        assert resp.status_code == 200
        body = resp.json()
        assert body["plan"] == "pro"
        assert body["stripe_subscription_id"] == "sub_abc"

    def test_response_has_expected_fields(self, client):
        resp = client.get("/api/v1/subscriptions/fields-test")
        assert resp.status_code == 200
        body = resp.json()
        for field in ("restaurant_id", "plan", "status", "stripe_subscription_id", "current_period_end"):
            assert field in body, f"Missing field: {field}"

    def test_free_subscription_has_null_stripe_id(self, client):
        resp = client.get("/api/v1/subscriptions/free-org-123")
        body = resp.json()
        assert body["stripe_subscription_id"] is None
        assert body["current_period_end"] is None


# ---------------------------------------------------------------------------
# POST /create-checkout — Stripe not configured
# ---------------------------------------------------------------------------

class TestCreateCheckout:
    def test_returns_503_when_stripe_not_configured(self, client, monkeypatch):
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_SECRET_KEY", "")
        resp = client.post(
            "/api/v1/subscriptions/create-checkout",
            json={"restaurant_id": "rest-abc"},
        )
        assert resp.status_code == 503

    def test_returns_already_pro_when_active_pro(self, client, test_db, monkeypatch):
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_SECRET_KEY", "sk_test_fake")
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_PRO_PRICE_ID", "price_test")
        _seed_subscription(test_db, "already-pro", plan="pro", status="active")
        resp = client.post(
            "/api/v1/subscriptions/create-checkout",
            json={"restaurant_id": "already-pro"},
        )
        assert resp.status_code == 200
        assert resp.json()["already_pro"] is True

    def test_calls_stripe_checkout_create(self, client, test_db, monkeypatch):
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_SECRET_KEY", "sk_test_fake")
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_PRO_PRICE_ID", "price_test_123")

        mock_session = MagicMock()
        mock_session.url = "https://checkout.stripe.com/pay/cs_test"
        mock_session.id = "cs_test_abc"

        with patch("stripe.checkout.Session.create", return_value=mock_session):
            resp = client.post(
                "/api/v1/subscriptions/create-checkout",
                json={"restaurant_id": "new-org", "customer_email": "owner@example.com"},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert "checkout_url" in body
        assert body["checkout_url"] == "https://checkout.stripe.com/pay/cs_test"


# ---------------------------------------------------------------------------
# POST /portal — Customer Portal
# ---------------------------------------------------------------------------

class TestCreatePortal:
    def test_returns_503_when_stripe_not_configured(self, client, monkeypatch):
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_SECRET_KEY", "")
        resp = client.post(
            "/api/v1/subscriptions/portal",
            json={"restaurant_id": "rest-abc"},
        )
        assert resp.status_code == 503

    def test_returns_400_when_no_subscription(self, client, monkeypatch):
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_SECRET_KEY", "sk_test_fake")
        # No subscription seeded → no stripe_subscription_id
        resp = client.post(
            "/api/v1/subscriptions/portal",
            json={"restaurant_id": "no-sub-org"},
        )
        assert resp.status_code == 400

    def test_creates_portal_session(self, client, test_db, monkeypatch):
        monkeypatch.setattr("app.routers.subscriptions.STRIPE_SECRET_KEY", "sk_test_fake")
        _seed_subscription(test_db, "portal-org", plan="pro", stripe_sub_id="sub_portal_123")

        mock_stripe_sub = {"customer": "cus_test_456"}
        mock_portal = MagicMock()
        mock_portal.url = "https://billing.stripe.com/portal/test"

        with patch("stripe.Subscription.retrieve", return_value=mock_stripe_sub), \
             patch("stripe.billing_portal.Session.create", return_value=mock_portal):
            resp = client.post(
                "/api/v1/subscriptions/portal",
                json={"restaurant_id": "portal-org"},
            )

        assert resp.status_code == 200
        assert resp.json()["portal_url"] == "https://billing.stripe.com/portal/test"


# ---------------------------------------------------------------------------
# POST /webhook — Stripe billing webhook (dev mode: no signature required)
# ---------------------------------------------------------------------------

class TestSubscriptionWebhook:
    def _post_event(self, client, event: dict):
        return client.post(
            "/api/v1/subscriptions/webhook",
            content=json.dumps(event),
            headers={"Content-Type": "application/json"},
        )

    def test_subscription_created_sets_pro_plan(self, client, test_db):
        event = _stripe_subscription_event(
            "customer.subscription.created",
            restaurant_id="org-created",
            stripe_status="active",
            stripe_sub_id="sub_created_abc",
        )
        resp = self._post_event(client, event)
        assert resp.status_code == 200

        session = test_db()
        sub = session.query(Subscription).filter_by(restaurant_id="org-created").first()
        assert sub is not None
        assert sub.plan == "pro"
        assert sub.status == "active"
        assert sub.stripe_subscription_id == "sub_created_abc"
        session.close()

    def test_subscription_updated_trialing_stays_pro(self, client, test_db):
        _seed_subscription(test_db, "org-trialing", plan="free", stripe_sub_id="sub_trial")
        event = _stripe_subscription_event(
            "customer.subscription.updated",
            restaurant_id="org-trialing",
            stripe_status="trialing",
            stripe_sub_id="sub_trial",
        )
        resp = self._post_event(client, event)
        assert resp.status_code == 200

        session = test_db()
        sub = session.query(Subscription).filter_by(restaurant_id="org-trialing").first()
        assert sub.plan == "pro"  # trialing → pro
        assert sub.status == "trialing"
        session.close()

    def test_subscription_deleted_downgrades_to_free(self, client, test_db):
        _seed_subscription(test_db, "org-deleted", plan="pro", stripe_sub_id="sub_del")
        event = _stripe_subscription_event(
            "customer.subscription.deleted",
            restaurant_id="org-deleted",
            stripe_status="canceled",
            stripe_sub_id="sub_del",
        )
        resp = self._post_event(client, event)
        assert resp.status_code == 200

        session = test_db()
        sub = session.query(Subscription).filter_by(restaurant_id="org-deleted").first()
        assert sub.plan == "free"
        assert sub.status == "canceled"
        session.close()

    def test_subscription_updated_past_due_downgrades(self, client, test_db):
        _seed_subscription(test_db, "org-past-due", plan="pro", stripe_sub_id="sub_pd")
        event = _stripe_subscription_event(
            "customer.subscription.updated",
            restaurant_id="org-past-due",
            stripe_status="past_due",
            stripe_sub_id="sub_pd",
        )
        resp = self._post_event(client, event)
        assert resp.status_code == 200

        session = test_db()
        sub = session.query(Subscription).filter_by(restaurant_id="org-past-due").first()
        assert sub.plan == "free"  # past_due → not active/trialing → free
        assert sub.status == "past_due"
        session.close()

    def test_webhook_writes_audit_log(self, client, test_db):
        event = _stripe_subscription_event(
            "customer.subscription.created",
            restaurant_id="org-audit",
            stripe_sub_id="sub_audit_abc",
        )
        self._post_event(client, event)

        session = test_db()
        log = (
            session.query(AuditLog)
            .filter(AuditLog.resource_id == "org-audit")
            .first()
        )
        assert log is not None
        assert "subscription" in log.action
        assert log.actor_id == "stripe"
        session.close()

    def test_webhook_missing_restaurant_id_is_noop(self, client):
        event = {
            "type": "customer.subscription.created",
            "data": {
                "object": {
                    "id": "sub_noop",
                    "status": "active",
                    "metadata": {},  # no restaurant_id
                    "current_period_end": 1800000000,
                }
            },
        }
        resp = self._post_event(client, event)
        assert resp.status_code == 200
        assert resp.json()["received"] is True

    def test_unknown_event_type_is_ignored(self, client):
        event = {
            "type": "invoice.payment_succeeded",
            "data": {"object": {}},
        }
        resp = self._post_event(client, event)
        assert resp.status_code == 200
        assert resp.json()["received"] is True

    def test_period_end_stored(self, client, test_db):
        period_end_ts = 1893456000  # ~2030-01-01
        event = _stripe_subscription_event(
            "customer.subscription.created",
            restaurant_id="org-period",
            stripe_sub_id="sub_period",
            period_end=period_end_ts,
        )
        self._post_event(client, event)

        session = test_db()
        sub = session.query(Subscription).filter_by(restaurant_id="org-period").first()
        assert sub.current_period_end is not None
        session.close()
