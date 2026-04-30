"""
Tests for payment endpoints:
  GET  /api/v1/payments/config        — returns Stripe publishable key
  POST /api/v1/payments/intent        — create PaymentIntent (mocked Stripe)
  POST /api/v1/payments/webhook       — Stripe webhook handler
  POST /api/public/menus/{slug}/feedback — NPS feedback submission
"""

import pytest
import stripe
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Payment, AuditLog, Menu


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
def menu(test_db):
    """Create a test Menu in the DB."""
    import json
    session = test_db()
    m = Menu(
        restaurant_name="Le Bistrot",
        slug="le-bistrot",
        pdf_path="menu.pdf",
        languages="fr,en",
        menu_data=json.dumps({"sections": []}),
        status="ready",
    )
    session.add(m)
    session.commit()
    session.close()
    return "le-bistrot"


# Fake Stripe PaymentIntent object
class _FakePI:
    id = "pi_test_123"
    client_secret = "pi_test_123_secret_abc"


# ---------------------------------------------------------------------------
# GET /api/v1/payments/config
# ---------------------------------------------------------------------------

def test_get_stripe_config_returns_key(client, monkeypatch):
    """Config endpoint returns the publishable key."""
    monkeypatch.setattr("app.routers.payments.STRIPE_PUBLISHABLE_KEY", "pk_test_abc")
    resp = client.get("/api/v1/payments/config")
    assert resp.status_code == 200
    assert resp.json()["publishable_key"] == "pk_test_abc"


# ---------------------------------------------------------------------------
# POST /api/v1/payments/intent
# ---------------------------------------------------------------------------

def test_create_payment_intent_returns_client_secret(client, monkeypatch):
    """POST /intent creates a Stripe PaymentIntent and returns client_secret."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    with patch("stripe.PaymentIntent.create", return_value=_FakePI()) as mock_create:
        resp = client.post(
            "/api/v1/payments/intent",
            json={
                "slug": "le-bistrot",
                "items": [{"name": "Steak", "price": 22.5, "quantity": 2}],
                "tip_amount": 0,
                "currency": "eur",
                "table_token": None,
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["client_secret"] == "pi_test_123_secret_abc"
    assert body["payment_intent_id"] == "pi_test_123"
    assert body["amount"] == 4500   # 2 × 22.50 EUR = 45.00 EUR = 4500 cents
    assert body["currency"] == "eur"


def test_create_payment_intent_includes_tip(client, monkeypatch):
    """Tip is added to the total amount."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    with patch("stripe.PaymentIntent.create", return_value=_FakePI()):
        resp = client.post(
            "/api/v1/payments/intent",
            json={
                "slug": "test",
                "items": [{"name": "Pizza", "price": 10.0, "quantity": 1}],
                "tip_amount": 1.5,
                "currency": "eur",
                "table_token": None,
            },
        )

    body = resp.json()
    assert body["amount"] == 1150  # 10.00 + 1.50 = 11.50 → 1150 cents


def test_create_payment_intent_below_minimum_returns_400(client, monkeypatch):
    """Amount < 0.50 EUR returns 400."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    resp = client.post(
        "/api/v1/payments/intent",
        json={
            "slug": "test",
            "items": [{"name": "Coffee", "price": 0.1, "quantity": 1}],
            "tip_amount": 0,
            "currency": "eur",
            "table_token": None,
        },
    )
    assert resp.status_code == 400


def test_create_payment_intent_no_stripe_key_returns_503(client, monkeypatch):
    """Missing STRIPE_SECRET_KEY → 503."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "")
    resp = client.post(
        "/api/v1/payments/intent",
        json={
            "slug": "test",
            "items": [{"name": "Burger", "price": 12.0, "quantity": 1}],
            "tip_amount": 0,
            "currency": "eur",
            "table_token": None,
        },
    )
    assert resp.status_code == 503


def test_create_payment_intent_persists_to_db(client, monkeypatch, test_db):
    """A Payment record is saved in the DB after creating an intent."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    with patch("stripe.PaymentIntent.create", return_value=_FakePI()):
        client.post(
            "/api/v1/payments/intent",
            json={
                "slug": "my-restaurant",
                "items": [{"name": "Salad", "price": 8.0, "quantity": 1}],
                "tip_amount": 0,
                "currency": "eur",
                "table_token": "tok_abc",
            },
        )

    session = test_db()
    payment = session.query(Payment).filter(Payment.payment_intent_id == "pi_test_123").first()
    session.close()

    assert payment is not None
    assert payment.menu_slug == "my-restaurant"
    assert payment.amount == 800
    assert payment.status == "pending"


def test_create_payment_intent_with_tip_stores_tip_amount(client, monkeypatch, test_db):
    """tip_amount is stored in the Payment record (in cents)."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    with patch("stripe.PaymentIntent.create", return_value=_FakePI()):
        client.post(
            "/api/v1/payments/intent",
            json={
                "slug": "tipping-test",
                "items": [{"name": "Beer", "price": 5.0, "quantity": 2}],
                "tip_amount": 1.5,
                "currency": "eur",
                "table_token": None,
            },
        )

    session = test_db()
    payment = session.query(Payment).filter(Payment.payment_intent_id == "pi_test_123").first()
    session.close()

    assert payment.tip_amount == 150  # 1.50 EUR = 150 cents
    assert payment.amount == 1150     # 10.00 + 1.50 = 1150 cents


# ---------------------------------------------------------------------------
# POST /api/v1/payments/webhook — payment_intent.succeeded
# ---------------------------------------------------------------------------

def _make_stripe_event(event_type: str, intent_id: str):
    """Minimal Stripe event object structure."""
    return {
        "type": event_type,
        "data": {
            "object": {"id": intent_id},
        },
    }


def _seed_payment(test_db, intent_id: str) -> Payment:
    """Insert a Payment row directly."""
    session = test_db()
    p = Payment(
        menu_slug="webhook-test",
        payment_intent_id=intent_id,
        amount=1000,
        tip_amount=0,
        currency="eur",
        status="pending",
    )
    session.add(p)
    session.commit()
    session.close()
    return p


def _mock_stripe_event(event_type: str, intent_id: str):
    """Build a mock event object that behaves like a Stripe Event dict."""
    raw = {"type": event_type, "data": {"object": {"id": intent_id}}}
    mock_event = MagicMock()
    mock_event.__getitem__ = lambda self, k: raw[k]
    return mock_event


def test_webhook_payment_succeeded_updates_status(client, monkeypatch, test_db):
    """Webhook payment_intent.succeeded → Payment.status = 'succeeded'."""
    monkeypatch.setattr("app.routers.payments.STRIPE_WEBHOOK_SECRET", "")

    intent_id = "pi_webhook_test_ok"
    _seed_payment(test_db, intent_id)

    import json
    payload = json.dumps({"type": "payment_intent.succeeded", "data": {"object": {"id": intent_id}}})

    # Patch the entire stripe module reference used by payments.py
    with patch("app.routers.payments.stripe") as mock_stripe:
        mock_stripe.STRIPE_WEBHOOK_SECRET = ""
        mock_stripe.api_key = "sk_test"
        mock_stripe.Event.construct_from.return_value = _mock_stripe_event("payment_intent.succeeded", intent_id)
        mock_stripe.util.json.loads.return_value = {}
        mock_stripe.util.convert_to_stripe_object.return_value = {}

        resp = client.post(
            "/api/v1/payments/webhook",
            content=payload,
            headers={"Content-Type": "application/json"},
        )

    assert resp.status_code == 200
    assert resp.json()["received"] is True

    # Verify DB was updated
    session = test_db()
    updated = session.query(Payment).filter(Payment.payment_intent_id == intent_id).first()
    session.close()
    assert updated.status == "succeeded"


def test_webhook_returns_received(client, monkeypatch):
    """Webhook endpoint returns {received: True} for an unknown event type."""
    monkeypatch.setattr("app.routers.payments.STRIPE_WEBHOOK_SECRET", "")

    import json
    payload = json.dumps({"type": "charge.updated", "data": {"object": {}}})

    with patch("app.routers.payments.stripe") as mock_stripe:
        mock_stripe.api_key = "sk_test"
        mock_stripe.Event.construct_from.return_value = _mock_stripe_event("charge.updated", "")
        mock_stripe.util.json.loads.return_value = {}
        mock_stripe.util.convert_to_stripe_object.return_value = {}

        resp = client.post(
            "/api/v1/payments/webhook",
            content=payload,
            headers={"Content-Type": "application/json"},
        )

    assert resp.status_code == 200
    assert resp.json()["received"] is True


# ---------------------------------------------------------------------------
# POST /api/public/menus/{slug}/feedback — NPS
# ---------------------------------------------------------------------------

def test_submit_feedback_stores_in_audit_log(client, menu, test_db):
    """Feedback submission stores an AuditLog entry."""
    resp = client.post(
        f"/api/public/menus/{menu}/feedback",
        json={
            "slug": menu,
            "nps_score": 9,
            "comment": "Super service !",
            "payment_intent_id": "pi_xxx",
            "lang": "fr",
        },
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    session = test_db()
    log = session.query(AuditLog).filter(AuditLog.action == "feedback.nps").first()
    session.close()

    assert log is not None
    assert log.payload["nps_score"] == 9
    assert log.payload["comment"] == "Super service !"


def test_submit_feedback_score_out_of_range_returns_400(client, menu):
    """nps_score must be 1–10; 11 returns 400."""
    resp = client.post(
        f"/api/public/menus/{menu}/feedback",
        json={"slug": menu, "nps_score": 11, "lang": "fr"},
    )
    assert resp.status_code == 400


def test_submit_feedback_score_zero_returns_400(client, menu):
    """nps_score=0 → 400."""
    resp = client.post(
        f"/api/public/menus/{menu}/feedback",
        json={"slug": menu, "nps_score": 0, "lang": "fr"},
    )
    assert resp.status_code == 400


def test_submit_feedback_without_comment(client, menu, test_db):
    """Feedback without comment stores null in payload."""
    resp = client.post(
        f"/api/public/menus/{menu}/feedback",
        json={"slug": menu, "nps_score": 7, "lang": "en"},
    )
    assert resp.status_code == 200

    session = test_db()
    log = session.query(AuditLog).filter(AuditLog.action == "feedback.nps").first()
    session.close()
    assert log.payload["comment"] is None


def test_submit_feedback_unknown_menu_still_succeeds(client):
    """Feedback for unknown menu stores audit log anyway (public endpoint, no auth)."""
    resp = client.post(
        "/api/public/menus/nonexistent-place/feedback",
        json={"slug": "nonexistent-place", "nps_score": 5, "lang": "fr"},
    )
    # No menu check on feedback endpoint — returns ok
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/v1/payments/intent — error + plan-gating coverage
# ---------------------------------------------------------------------------

def test_create_payment_intent_stripe_error_returns_502(client, monkeypatch):
    """When Stripe raises StripeError, the endpoint returns 502."""
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    with patch("stripe.PaymentIntent.create", side_effect=stripe.StripeError("card_error")):
        resp = client.post(
            "/api/v1/payments/intent",
            json={
                "slug": "error-test",
                "items": [{"name": "Wine", "price": 15.0, "quantity": 1}],
                "tip_amount": 0,
                "currency": "eur",
                "table_token": None,
            },
        )

    assert resp.status_code == 502


def test_create_payment_intent_free_plan_returns_402(client, monkeypatch, test_db):
    """When restaurant has a free subscription, payment intent returns 402."""
    from app.models import Subscription
    monkeypatch.setattr("app.routers.payments.STRIPE_SECRET_KEY", "sk_test_abc")

    # Seed a free-plan subscription
    session = test_db()
    sub = Subscription(restaurant_id="free-restaurant", plan="free", status="active")
    session.add(sub)
    session.commit()
    session.close()

    resp = client.post(
        "/api/v1/payments/intent",
        json={
            "slug": "free-restaurant",
            "items": [{"name": "Steak", "price": 20.0, "quantity": 1}],
            "tip_amount": 0,
            "currency": "eur",
            "table_token": None,
        },
    )

    assert resp.status_code == 402


# ---------------------------------------------------------------------------
# POST /api/v1/payments/webhook — payment_failed + signed path
# ---------------------------------------------------------------------------

def test_webhook_payment_failed_updates_status(client, monkeypatch, test_db):
    """Webhook payment_intent.payment_failed → Payment.status = 'failed'."""
    monkeypatch.setattr("app.routers.payments.STRIPE_WEBHOOK_SECRET", "")

    intent_id = "pi_failed_test"
    _seed_payment(test_db, intent_id)

    import json
    payload = json.dumps({"type": "payment_intent.payment_failed", "data": {"object": {"id": intent_id}}})

    with patch("app.routers.payments.stripe") as mock_stripe:
        mock_stripe.api_key = "sk_test"
        mock_stripe.Event.construct_from.return_value = _mock_stripe_event("payment_intent.payment_failed", intent_id)
        mock_stripe.util.json.loads.return_value = {}
        mock_stripe.util.convert_to_stripe_object.return_value = {}

        resp = client.post(
            "/api/v1/payments/webhook",
            content=payload,
            headers={"Content-Type": "application/json"},
        )

    assert resp.status_code == 200

    session = test_db()
    updated = session.query(Payment).filter(Payment.payment_intent_id == intent_id).first()
    session.close()
    assert updated.status == "failed"


def test_webhook_signed_valid(client, monkeypatch, test_db):
    """Webhook with STRIPE_WEBHOOK_SECRET set → calls Webhook.construct_event."""
    monkeypatch.setattr("app.routers.payments.STRIPE_WEBHOOK_SECRET", "whsec_test")

    intent_id = "pi_signed_test"
    _seed_payment(test_db, intent_id)

    import json
    payload = json.dumps({"type": "payment_intent.succeeded", "data": {"object": {"id": intent_id}}})

    with patch("app.routers.payments.stripe") as mock_stripe:
        mock_stripe.api_key = "sk_test"
        mock_stripe.Webhook.construct_event.return_value = _mock_stripe_event("payment_intent.succeeded", intent_id)

        resp = client.post(
            "/api/v1/payments/webhook",
            content=payload,
            headers={"Content-Type": "application/json", "stripe-signature": "t=1,v1=abc"},
        )

    assert resp.status_code == 200
    mock_stripe.Webhook.construct_event.assert_called_once()


def test_webhook_signed_invalid_signature_returns_400(client, monkeypatch):
    """Webhook with bad signature → 400."""
    monkeypatch.setattr("app.routers.payments.STRIPE_WEBHOOK_SECRET", "whsec_test")

    import json
    payload = json.dumps({"type": "payment_intent.succeeded", "data": {"object": {"id": "pi_x"}}})

    with patch("app.routers.payments.stripe") as mock_stripe:
        mock_stripe.api_key = "sk_test"
        mock_stripe.error.SignatureVerificationError = stripe.error.SignatureVerificationError
        mock_stripe.Webhook.construct_event.side_effect = stripe.error.SignatureVerificationError(
            "Bad signature", b"sig_header"
        )

        resp = client.post(
            "/api/v1/payments/webhook",
            content=payload,
            headers={"Content-Type": "application/json", "stripe-signature": "bad"},
        )

    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# GET /api/v1/payments/{intent_id}/receipt.pdf
# ---------------------------------------------------------------------------

def test_download_receipt_not_found(client):
    """Unknown payment_intent_id → 404."""
    resp = client.get("/api/v1/payments/pi_unknown_xyz/receipt.pdf")
    assert resp.status_code == 404


def test_download_receipt_not_succeeded_returns_400(client, test_db):
    """Pending payment cannot download receipt → 400."""
    _seed_payment(test_db, "pi_receipt_pending")
    resp = client.get("/api/v1/payments/pi_receipt_pending/receipt.pdf")
    assert resp.status_code == 400


def test_download_receipt_success_returns_pdf(client, test_db):
    """Succeeded payment returns PDF bytes."""
    session = test_db()
    p = Payment(
        menu_slug="pdf-restaurant",
        payment_intent_id="pi_receipt_ok",
        amount=2500,
        tip_amount=200,
        currency="eur",
        status="succeeded",
        items=[{"name": "Steak", "price": 23.0, "quantity": 1}],
    )
    session.add(p)
    session.commit()
    session.close()

    resp = client.get("/api/v1/payments/pi_receipt_ok/receipt.pdf")

    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    # PDF magic bytes
    assert resp.content[:4] == b"%PDF"

