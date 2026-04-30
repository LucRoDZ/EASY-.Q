"""
Tests for analytics dashboard endpoints:
  GET /api/v1/analytics/revenue   — daily revenue breakdown
  GET /api/v1/analytics/chatbot   — chatbot session metrics
  GET /api/v1/analytics/items     — top items sold
"""

import json
from datetime import datetime, timezone, timedelta

import pytest
from unittest.mock import AsyncMock
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Conversation, Menu, Payment


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
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture
def client(test_db, monkeypatch):
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "init_redis", AsyncMock())
    monkeypatch.setattr(redis_core, "close_redis", AsyncMock())
    with TestClient(app) as c:
        yield c


@pytest.fixture
def slug(test_db):
    """Create a Menu and return its slug."""
    session = test_db()
    m = Menu(
        restaurant_name="Le Café",
        slug="le-cafe",
        pdf_path="menu.pdf",
        languages="fr,en",
        menu_data=json.dumps({"sections": []}),
        status="ready",
    )
    session.add(m)
    session.commit()
    session.close()
    return "le-cafe"


def _seed_payment(test_db, slug: str, amount: int = 2000, tip: int = 0,
                  table_token: str | None = "tok_01",
                  items: list | None = None,
                  days_ago: int = 0) -> None:
    """Insert a succeeded Payment row."""
    session = test_db()
    dt = datetime.now(timezone.utc) - timedelta(days=days_ago)
    p = Payment(
        menu_slug=slug,
        payment_intent_id=f"pi_{slug}_{amount}_{days_ago}_{id(items)}",
        amount=amount,
        tip_amount=tip,
        currency="eur",
        status="succeeded",
        table_token=table_token,
        items=items or [{"name": "Steak", "price": 20.0, "quantity": 1}],
        created_at=dt,
    )
    session.add(p)
    session.commit()
    session.close()


def _seed_conversation(test_db, menu_id: int, session_id: str,
                       messages: list | None = None) -> None:
    session = test_db()
    c = Conversation(
        menu_id=menu_id,
        session_id=session_id,
        messages=json.dumps(messages or [
            {"role": "user", "content": "Bonjour"},
            {"role": "assistant", "content": "Bonjour !"},
        ]),
    )
    session.add(c)
    session.commit()
    session.close()


def _get_menu_id(test_db, slug: str) -> int:
    session = test_db()
    m = session.query(Menu).filter(Menu.slug == slug).first()
    mid = m.id
    session.close()
    return mid


# ===========================================================================
# GET /api/v1/analytics/revenue
# ===========================================================================

class TestAnalyticsRevenue:

    def test_revenue_returns_200_for_valid_slug(self, client, slug):
        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=7d")
        assert resp.status_code == 200

    def test_revenue_returns_404_for_unknown_slug(self, client):
        resp = client.get("/api/v1/analytics/revenue?slug=nonexistent-xyz&period=7d")
        assert resp.status_code == 404

    def test_revenue_has_daily_key(self, client, slug):
        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=7d")
        assert "daily" in resp.json()

    def test_revenue_daily_list_has_8_entries_for_7d(self, client, slug):
        # _build_date_series is inclusive of both start and end day → 7d = 8 entries
        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=7d")
        daily = resp.json()["daily"]
        assert len(daily) == 8

    def test_revenue_daily_list_has_31_entries_for_30d(self, client, slug):
        # inclusive range: 30 prior days + today = 31 entries
        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=30d")
        daily = resp.json()["daily"]
        assert len(daily) == 31

    def test_revenue_daily_entry_has_expected_keys(self, client, slug):
        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=7d")
        entry = resp.json()["daily"][0]
        assert "date" in entry
        assert "revenue" in entry
        assert "transactions" in entry

    def test_revenue_sums_payments_on_correct_day(self, client, slug, test_db):
        _seed_payment(test_db, slug, amount=5000, days_ago=1)  # 50.00 EUR
        _seed_payment(test_db, slug, amount=3000, days_ago=1)  # 30.00 EUR

        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=7d")
        daily = resp.json()["daily"]

        # Find yesterday's entry
        yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
        day_entry = next((d for d in daily if d["date"] == yesterday), None)

        assert day_entry is not None
        assert day_entry["revenue"] == 80.0
        assert day_entry["transactions"] == 2

    def test_revenue_excludes_pending_payments(self, client, slug, test_db):
        # Add a pending payment — should NOT appear in revenue
        session = test_db()
        from app.models import Payment as PaymentModel
        p = PaymentModel(
            menu_slug=slug,
            payment_intent_id="pi_pending_rev",
            amount=9999,
            tip_amount=0,
            currency="eur",
            status="pending",
            items=[],
        )
        session.add(p)
        session.commit()
        session.close()

        resp = client.get(f"/api/v1/analytics/revenue?slug={slug}&period=7d")
        daily = resp.json()["daily"]
        total_revenue = sum(d["revenue"] for d in daily)
        assert total_revenue == 0.0

    def test_revenue_custom_period(self, client, slug, test_db):
        _seed_payment(test_db, slug, amount=4000, days_ago=3)
        from_date = (datetime.now(timezone.utc) - timedelta(days=5)).date().isoformat()
        to_date = datetime.now(timezone.utc).date().isoformat()

        resp = client.get(
            f"/api/v1/analytics/revenue?slug={slug}&period=custom"
            f"&from_date={from_date}&to_date={to_date}"
        )
        assert resp.status_code == 200
        daily = resp.json()["daily"]
        assert len(daily) == 6  # from 5 days ago to today inclusive


# ===========================================================================
# GET /api/v1/analytics/chatbot
# ===========================================================================

class TestAnalyticsChatbot:

    def test_chatbot_returns_200_for_valid_slug(self, client, slug):
        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        assert resp.status_code == 200

    def test_chatbot_returns_404_for_unknown_slug(self, client):
        resp = client.get("/api/v1/analytics/chatbot?slug=no-such-menu&period=7d")
        assert resp.status_code == 404

    def test_chatbot_has_expected_keys(self, client, slug):
        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        body = resp.json()
        assert "total_sessions" in body
        assert "total_messages" in body
        assert "avg_messages_per_session" in body
        assert "daily_sessions" in body

    def test_chatbot_zero_when_no_conversations(self, client, slug):
        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        body = resp.json()
        assert body["total_sessions"] == 0
        assert body["total_messages"] == 0
        assert body["avg_messages_per_session"] == 0

    def test_chatbot_counts_sessions(self, client, slug, test_db):
        menu_id = _get_menu_id(test_db, slug)
        _seed_conversation(test_db, menu_id, "sess_1")
        _seed_conversation(test_db, menu_id, "sess_2")

        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        body = resp.json()
        assert body["total_sessions"] == 2

    def test_chatbot_counts_messages(self, client, slug, test_db):
        menu_id = _get_menu_id(test_db, slug)
        # 2 messages per conversation, 3 conversations → 6 total
        for i in range(3):
            _seed_conversation(test_db, menu_id, f"sess_msg_{i}", messages=[
                {"role": "user", "content": "?"},
                {"role": "assistant", "content": "!"},
            ])

        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        body = resp.json()
        assert body["total_messages"] == 6
        assert body["avg_messages_per_session"] == 2.0

    def test_chatbot_daily_sessions_has_8_entries(self, client, slug):
        # inclusive range: 7 prior days + today = 8 entries
        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        daily = resp.json()["daily_sessions"]
        assert len(daily) == 8

    def test_chatbot_daily_sessions_entry_has_date_and_sessions(self, client, slug):
        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=7d")
        entry = resp.json()["daily_sessions"][0]
        assert "date" in entry
        assert "sessions" in entry

    def test_chatbot_period_30d(self, client, slug):
        resp = client.get(f"/api/v1/analytics/chatbot?slug={slug}&period=30d")
        assert resp.status_code == 200
        daily = resp.json()["daily_sessions"]
        assert len(daily) == 31  # inclusive range


# ===========================================================================
# GET /api/v1/analytics/items
# ===========================================================================

class TestAnalyticsItems:

    def test_items_returns_200_for_valid_slug(self, client, slug):
        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        assert resp.status_code == 200

    def test_items_returns_404_for_unknown_slug(self, client):
        resp = client.get("/api/v1/analytics/items?slug=nonexistent&period=7d")
        assert resp.status_code == 404

    def test_items_has_items_key(self, client, slug):
        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        assert "items" in resp.json()

    def test_items_empty_when_no_payments(self, client, slug):
        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        assert resp.json()["items"] == []

    def test_items_counts_quantities(self, client, slug, test_db):
        _seed_payment(test_db, slug, amount=2000, items=[
            {"name": "Steak", "price": 20.0, "quantity": 2},
            {"name": "Wine", "price": 8.0, "quantity": 1},
        ])
        _seed_payment(test_db, slug, amount=1000, items=[
            {"name": "Steak", "price": 20.0, "quantity": 1},
        ])

        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        items = resp.json()["items"]

        steak = next(i for i in items if i["name"] == "Steak")
        wine = next(i for i in items if i["name"] == "Wine")

        assert steak["quantity"] == 3   # 2 + 1
        assert wine["quantity"] == 1

    def test_items_sorted_by_quantity_desc(self, client, slug, test_db):
        _seed_payment(test_db, slug, amount=1000, items=[
            {"name": "Water", "price": 2.0, "quantity": 5},
            {"name": "Steak", "price": 30.0, "quantity": 1},
        ])

        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        items = resp.json()["items"]

        assert items[0]["name"] == "Water"  # highest quantity first

    def test_items_calculates_revenue(self, client, slug, test_db):
        _seed_payment(test_db, slug, amount=6000, items=[
            {"name": "Wine", "price": 30.0, "quantity": 2},
        ])

        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        items = resp.json()["items"]
        wine = next(i for i in items if i["name"] == "Wine")

        assert wine["revenue"] == 60.0  # 30.0 × 2

    def test_items_entry_has_expected_keys(self, client, slug, test_db):
        _seed_payment(test_db, slug, amount=2000)

        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        item = resp.json()["items"][0]

        assert "name" in item
        assert "quantity" in item
        assert "revenue" in item

    def test_items_excludes_pending_payments(self, client, slug, test_db):
        session = test_db()
        from app.models import Payment as PaymentModel
        p = PaymentModel(
            menu_slug=slug,
            payment_intent_id="pi_pending_items",
            amount=3000,
            tip_amount=0,
            currency="eur",
            status="pending",
            items=[{"name": "Lobster", "price": 30.0, "quantity": 1}],
        )
        session.add(p)
        session.commit()
        session.close()

        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=7d")
        items = resp.json()["items"]
        names = [i["name"] for i in items]
        assert "Lobster" not in names

    def test_items_period_30d(self, client, slug):
        resp = client.get(f"/api/v1/analytics/items?slug={slug}&period=30d")
        assert resp.status_code == 200
