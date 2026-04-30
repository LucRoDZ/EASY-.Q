"""
Shared pytest fixtures for EASY.Q backend tests.

Provides:
  - test_db     — in-memory SQLite session, overrides get_db dependency
  - client      — TestClient with Redis mocked out
  - mock_gemini — patches google.generativeai so tests never call the real API
"""

import os
# Force SQLite for tests before any app module is imported (avoids asyncpg/psycopg2 deps)
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_easyq.db")

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Menu, Subscription


# ---------------------------------------------------------------------------
# Database fixture — in-memory SQLite, isolated per test function
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def test_db():
    """Create a fresh in-memory SQLite database for each test.

    Overrides the app's get_db dependency so all routes use this DB.
    Yields the sessionmaker so tests can query the DB directly.
    """
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


# ---------------------------------------------------------------------------
# HTTP client fixture — TestClient with Redis mocked
# ---------------------------------------------------------------------------

@pytest.fixture
def client(test_db, monkeypatch):
    """FastAPI TestClient with the in-memory DB and mocked Redis lifecycle."""
    import app.core.redis as redis_core

    monkeypatch.setattr(redis_core, "init_redis", AsyncMock())
    monkeypatch.setattr(redis_core, "close_redis", AsyncMock())

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Redis helper mocks — for tests that exercise cache paths
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_redis_no_cache(monkeypatch):
    """Patch Redis helpers to always return cache-miss (None/False)."""
    import app.core.redis as redis_core

    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_ocr_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())


# ---------------------------------------------------------------------------
# Gemini / google.generativeai mock
# ---------------------------------------------------------------------------

@pytest.fixture
def mock_gemini():
    """Patch google.generativeai so tests never reach the real Gemini API.

    Returns a mock response with a sensible menu JSON payload.
    """
    fake_menu_json = json.dumps({
        "restaurant_name": "Test Restaurant",
        "currency": "EUR",
        "sections": [
            {
                "title": "Starters",
                "items": [
                    {
                        "name": "Soup",
                        "description": "Tomato soup",
                        "price": 6.5,
                        "allergens": [],
                        "tags": ["vegetarian"],
                    }
                ],
            }
        ],
        "wines": [],
    })

    mock_response = MagicMock()
    mock_response.text = fake_menu_json

    mock_model = MagicMock()
    mock_model.generate_content.return_value = mock_response

    with patch("google.generativeai.GenerativeModel", return_value=mock_model) as p:
        yield p


# ---------------------------------------------------------------------------
# Common DB seed helpers (reusable across test modules)
# ---------------------------------------------------------------------------

def seed_menu(
    test_db,
    restaurant_name: str = "Le Bistrot",
    slug: str = "le-bistrot",
    status: str = "ready",
    publish_status: str = "draft",
    menu_data: dict | None = None,
) -> int:
    """Insert a Menu row and return its id."""
    if menu_data is None:
        menu_data = {
            "restaurant_name": restaurant_name,
            "sections": [
                {
                    "title": "Entrées",
                    "items": [
                        {"name": "Soupe", "price": 7.0, "allergens": [], "tags": ["vegetarian"]},
                    ],
                }
            ],
            "wines": [],
        }
    session = test_db()
    m = Menu(
        restaurant_name=restaurant_name,
        slug=slug,
        pdf_path="menu.pdf",
        languages="fr,en,es",
        menu_data=json.dumps(menu_data),
        status=status,
        publish_status=publish_status,
    )
    session.add(m)
    session.commit()
    menu_id = m.id
    session.close()
    return menu_id


def seed_pro_subscription(test_db, restaurant_id: str) -> None:
    """Give a restaurant a Pro subscription so payment/feature-gated endpoints work."""
    session = test_db()
    sub = Subscription(
        restaurant_id=restaurant_id,
        plan="pro",
        status="active",
    )
    session.add(sub)
    session.commit()
    session.close()
