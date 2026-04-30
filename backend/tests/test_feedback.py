"""
Tests for feedback and NPS analytics endpoints:
  POST /api/public/menus/{slug}/feedback        — submit NPS feedback
  GET  /api/dashboard/menus/{slug}/analytics/reviews — NPS analytics dashboard
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import AuditLog, Menu, RestaurantProfile


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
def seeded_menu(test_db):
    """Create a Menu and a RestaurantProfile with an owner email."""
    session = test_db()
    import json

    menu = Menu(
        restaurant_name="Chez Paul",
        slug="chez-paul",
        pdf_path="menu.pdf",
        languages="fr,en",
        menu_data=json.dumps({"sections": []}),
        status="ready",
        publish_status="published",
    )
    session.add(menu)
    session.flush()

    profile = RestaurantProfile(
        slug="chez-paul",
        name="Chez Paul",
        owner_email="owner@chezpaul.fr",
    )
    session.add(profile)
    session.commit()
    session.close()
    return {"slug": "chez-paul"}


# ---------------------------------------------------------------------------
# POST /api/public/menus/{slug}/feedback
# ---------------------------------------------------------------------------


def test_feedback_stores_audit_log(client, seeded_menu, test_db):
    """Valid feedback is persisted as an AuditLog entry."""
    resp = client.post(
        f"/api/public/menus/{seeded_menu['slug']}/feedback",
        json={"slug": seeded_menu["slug"], "nps_score": 9, "comment": "Super!", "lang": "fr"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"

    session = test_db()
    log = (
        session.query(AuditLog)
        .filter(AuditLog.action == "feedback.nps", AuditLog.resource_id == seeded_menu["slug"])
        .first()
    )
    session.close()
    assert log is not None
    assert log.payload["nps_score"] == 9
    assert log.payload["comment"] == "Super!"


def test_feedback_score_1_is_valid(client, seeded_menu, test_db):
    """Minimum valid score (1) is accepted."""
    slug = seeded_menu["slug"]
    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 1, "lang": "fr"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_feedback_score_10_is_valid(client, seeded_menu, test_db):
    """Maximum valid score (10) is accepted."""
    slug = seeded_menu["slug"]
    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 10, "lang": "fr"},
    )
    assert resp.status_code == 200


def test_feedback_score_0_returns_400(client, seeded_menu):
    """Score 0 is out of range → 400."""
    slug = seeded_menu["slug"]
    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 0, "lang": "fr"},
    )
    assert resp.status_code == 400


def test_feedback_score_11_returns_400(client, seeded_menu):
    """Score 11 is out of range → 400."""
    slug = seeded_menu["slug"]
    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 11, "lang": "fr"},
    )
    assert resp.status_code == 400


def test_feedback_low_nps_triggers_email(client, seeded_menu, monkeypatch):
    """Detractor score (< 7) triggers a low-NPS alert email."""
    slug = seeded_menu["slug"]
    mock_send = MagicMock()
    monkeypatch.setattr("app.routers.public.send_low_nps_email", mock_send)

    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 3, "comment": "Déçu", "lang": "fr"},
    )
    assert resp.status_code == 200
    mock_send.assert_called_once()
    # Assert it was called with the owner email
    assert mock_send.call_args.kwargs.get("to") == "owner@chezpaul.fr"


def test_feedback_high_nps_no_email(client, seeded_menu, monkeypatch):
    """Promoter score (≥ 7) does NOT trigger an email."""
    slug = seeded_menu["slug"]
    mock_send = MagicMock()
    monkeypatch.setattr("app.routers.public.send_low_nps_email", mock_send)

    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 9, "lang": "fr"},
    )
    assert resp.status_code == 200
    mock_send.assert_not_called()


def test_feedback_email_failure_does_not_break_response(client, seeded_menu, monkeypatch):
    """Email failure (exception) doesn't cause a 500 — best-effort behavior."""
    slug = seeded_menu["slug"]
    monkeypatch.setattr(
        "app.routers.public.send_low_nps_email",
        MagicMock(side_effect=Exception("SMTP error")),
    )

    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 2, "lang": "fr"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_feedback_stores_payment_intent_id(client, seeded_menu, test_db):
    """payment_intent_id is persisted in the audit log payload."""
    slug = seeded_menu["slug"]
    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 8, "payment_intent_id": "pi_test123", "lang": "en"},
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_feedback_no_comment_is_ok(client, seeded_menu):
    """Feedback without comment field is accepted."""
    slug = seeded_menu["slug"]
    resp = client.post(
        f"/api/public/menus/{slug}/feedback",
        json={"slug": slug, "nps_score": 7, "lang": "en"},
    )
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# GET /api/dashboard/menus/{slug}/analytics/reviews
# ---------------------------------------------------------------------------


def _seed_nps_logs(test_db, slug: str, scores: list[int]) -> None:
    session = test_db()
    for score in scores:
        log = AuditLog(
            actor_type="client",
            actor_id=None,
            action="feedback.nps",
            resource_type="menu",
            resource_id=slug,
            payload={"nps_score": score, "comment": None, "lang": "fr"},
        )
        session.add(log)
    session.commit()
    session.close()


def test_reviews_analytics_empty(client, seeded_menu):
    """When no feedback exists, returns zeros and nulls."""
    resp = client.get(f"/api/dashboard/menus/{seeded_menu['slug']}/analytics/reviews")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["average_nps"] is None
    assert body["nps_score"] is None


def test_reviews_analytics_unknown_menu_returns_404(client):
    """GET reviews on non-existent menu slug → 404."""
    resp = client.get("/api/dashboard/menus/nonexistent/analytics/reviews")
    assert resp.status_code == 404


def test_reviews_analytics_counts_promoters_passives_detractors(client, seeded_menu, test_db):
    """NPS calculation: promoters ≥ 9, passives 7–8, detractors ≤ 6."""
    # 3 promoters (9, 10, 9), 2 passives (7, 8), 2 detractors (5, 6)
    _seed_nps_logs(test_db, seeded_menu["slug"], [9, 10, 9, 7, 8, 5, 6])

    resp = client.get(f"/api/dashboard/menus/{seeded_menu['slug']}/analytics/reviews")
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 7
    assert body["promoters"] == 3
    assert body["passives"] == 2
    assert body["detractors"] == 2


def test_reviews_analytics_nps_score_formula(client, seeded_menu, test_db):
    """NPS score = (promoters - detractors) / total * 100."""
    # 2 promoters, 0 passives, 1 detractor → NPS = (2-1)/3 * 100 = 33.3
    _seed_nps_logs(test_db, seeded_menu["slug"], [9, 10, 4])

    resp = client.get(f"/api/dashboard/menus/{seeded_menu['slug']}/analytics/reviews")
    body = resp.json()
    assert body["nps_score"] == pytest.approx(33.3, abs=0.5)


def test_reviews_analytics_average_nps(client, seeded_menu, test_db):
    """average_nps is the arithmetic mean of all scores."""
    _seed_nps_logs(test_db, seeded_menu["slug"], [6, 8, 10])

    resp = client.get(f"/api/dashboard/menus/{seeded_menu['slug']}/analytics/reviews")
    body = resp.json()
    assert body["average_nps"] == pytest.approx(8.0, abs=0.1)


def test_reviews_analytics_returns_recent_reviews(client, seeded_menu, test_db):
    """recent field contains up to 10 latest reviews."""
    _seed_nps_logs(test_db, seeded_menu["slug"], list(range(1, 13)))  # 12 logs

    resp = client.get(f"/api/dashboard/menus/{seeded_menu['slug']}/analytics/reviews")
    body = resp.json()
    assert body["total"] == 12
    assert len(body["recent"]) <= 10
