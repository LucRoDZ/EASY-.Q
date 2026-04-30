"""
Tests for translation endpoints:
  PATCH /api/v1/menus/{id}/translate?lang=en  — auto-translate via Gemini
  PATCH /api/v1/menus/{id}/translations/{lang} — save manual override
  POST  /api/v1/menus/{id}/translate/all       — bulk translate all languages
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
from app.models import Menu


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

MOCK_MENU_DATA = {
    "restaurant_name": "Le Bistrot Test",
    "currency": "EUR",
    "sections": [
        {
            "title": "Entrées",
            "items": [
                {
                    "name": "Salade César",
                    "description": "Laitue romaine, parmesan",
                    "price": 9.50,
                    "allergens": ["lactose"],
                    "tags": ["vegetarian"],
                }
            ],
        },
        {
            "title": "Plats",
            "items": [
                {
                    "name": "Steak Frites",
                    "description": "Bœuf grillé, frites maison",
                    "price": 18.50,
                    "allergens": ["gluten"],
                    "tags": ["meat"],
                }
            ],
        },
    ],
    "wines": [
        {"name": "Bordeaux Rouge", "type": "red", "price": 28.0, "pairing_tags": ["meat"]}
    ],
}

MOCK_EN_TRANSLATION = {
    "sections": [
        {
            "title": "Starters",
            "items": [
                {
                    "name": "Caesar Salad",
                    "description": "Romaine lettuce, parmesan",
                    "price": 9.50,
                    "allergens": ["lactose"],
                    "tags": ["vegetarian"],
                }
            ],
        },
        {
            "title": "Main Courses",
            "items": [
                {
                    "name": "Steak and Chips",
                    "description": "Grilled beef, homemade chips",
                    "price": 18.50,
                    "allergens": ["gluten"],
                    "tags": ["meat"],
                }
            ],
        },
    ],
    "wines": [
        {"name": "Red Bordeaux", "type": "red", "price": 28.0, "pairing_tags": ["meat"]}
    ],
}


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
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())

    with TestClient(app) as c:
        yield c


def _create_menu(test_db, menu_data=None, status="ready") -> int:
    session = test_db()
    menu = Menu(
        restaurant_name="Le Bistrot Test",
        slug="le-bistrot-test",
        pdf_path="/tmp/test.pdf",
        languages="fr",
        menu_data=json.dumps(menu_data or MOCK_MENU_DATA),
        status=status,
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()
    return menu_id


# ---------------------------------------------------------------------------
# Auto-translate endpoint: PATCH /api/v1/menus/{id}/translate
# ---------------------------------------------------------------------------

def test_translate_to_english_returns_translated_sections(client, test_db):
    """PATCH /translate?lang=en calls Gemini and returns translated sections."""
    menu_id = _create_menu(test_db)

    with patch("app.routers.menu.translate_menu", return_value=MOCK_EN_TRANSLATION):
        resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=en")

    assert resp.status_code == 200
    body = resp.json()
    assert body["lang"] == "en"
    assert body["sections"][0]["title"] == "Starters"
    assert body["sections"][0]["items"][0]["name"] == "Caesar Salad"
    assert body["wines"][0]["name"] == "Red Bordeaux"


def test_translate_to_spanish_stores_in_db(client, test_db):
    """PATCH /translate?lang=es stores translation in menu_data.translations."""
    menu_id = _create_menu(test_db)
    es_translation = {
        "sections": [{"title": "Entrantes", "items": [{"name": "Ensalada César", "price": 9.50}]}],
        "wines": [{"name": "Burdeos Tinto", "type": "red", "price": 28.0, "pairing_tags": ["meat"]}],
    }

    with patch("app.routers.menu.translate_menu", return_value=es_translation):
        resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=es")

    assert resp.status_code == 200

    # Verify it was stored in DB
    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    data = json.loads(menu.menu_data)
    session.close()

    assert "translations" in data
    assert "es" in data["translations"]
    assert data["translations"]["es"]["sections"][0]["title"] == "Entrantes"


def test_translate_unknown_lang_returns_400(client, test_db):
    """PATCH /translate?lang=de → 400 invalid language."""
    menu_id = _create_menu(test_db)
    resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=de")
    assert resp.status_code == 400
    assert "lang" in resp.json()["detail"].lower()


def test_translate_missing_menu_returns_404(client):
    """PATCH /translate for unknown menu_id → 404."""
    with patch("app.routers.menu.translate_menu", return_value={"sections": [], "wines": []}):
        resp = client.patch("/api/v1/menus/99999/translate?lang=en")
    assert resp.status_code == 404


def test_translate_adds_lang_to_languages_field(client, test_db):
    """PATCH /translate?lang=en adds 'en' to menu.languages field."""
    menu_id = _create_menu(test_db)

    with patch("app.routers.menu.translate_menu", return_value=MOCK_EN_TRANSLATION):
        client.patch(f"/api/v1/menus/{menu_id}/translate?lang=en")

    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()

    assert "en" in menu.languages
    assert "fr" in menu.languages  # fr always added


def test_translate_uses_cache_when_available(client, test_db, monkeypatch):
    """PATCH /translate returns cached result without calling Gemini."""
    import app.core.redis as redis_core
    menu_id = _create_menu(test_db)

    cached = {
        "sections": [{"title": "Starters (cached)", "items": []}],
        "wines": [],
    }
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=cached))

    gemini_mock = MagicMock()
    with patch("app.routers.menu.translate_menu", gemini_mock):
        resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=en")

    assert resp.status_code == 200
    assert resp.json()["sections"][0]["title"] == "Starters (cached)"
    gemini_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Manual override endpoint: PATCH /api/v1/menus/{id}/translations/{lang}
# ---------------------------------------------------------------------------

def test_save_translation_stores_manual_override(client, test_db):
    """PATCH /translations/en persists manual edits to menu_data.translations."""
    menu_id = _create_menu(test_db)

    body = {
        "sections": [{"title": "Starters", "items": [{"name": "Caesar Salad", "price": 9.50}]}],
        "wines": [{"name": "Red Bordeaux", "type": "red", "price": 28.0, "pairing_tags": []}],
    }
    resp = client.patch(f"/api/v1/menus/{menu_id}/translations/en", json=body)

    assert resp.status_code == 200
    rb = resp.json()
    assert rb["lang"] == "en"
    assert rb["sections"][0]["title"] == "Starters"


def test_save_translation_overwrites_previous(client, test_db):
    """PATCH /translations/en replaces any existing translation for that lang."""
    session = test_db()
    existing_data = dict(MOCK_MENU_DATA)
    existing_data["translations"] = {"en": {"sections": [{"title": "Old English", "items": []}], "wines": []}}
    menu = Menu(
        restaurant_name="Override Test",
        slug="override-test",
        pdf_path="/tmp/x.pdf",
        languages="en,fr",
        menu_data=json.dumps(existing_data),
        status="ready",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    body = {
        "sections": [{"title": "New English Title", "items": []}],
        "wines": [],
    }
    resp = client.patch(f"/api/v1/menus/{menu_id}/translations/en", json=body)
    assert resp.status_code == 200

    session = test_db()
    updated = session.query(Menu).filter(Menu.id == menu_id).first()
    data = json.loads(updated.menu_data)
    session.close()

    assert data["translations"]["en"]["sections"][0]["title"] == "New English Title"


def test_save_translation_invalid_lang_returns_400(client, test_db):
    """PATCH /translations/zh → 400."""
    menu_id = _create_menu(test_db)
    resp = client.patch(f"/api/v1/menus/{menu_id}/translations/zh", json={"sections": [], "wines": []})
    assert resp.status_code == 400


def test_save_translation_not_found_returns_404(client):
    """PATCH /translations/en for unknown menu → 404."""
    resp = client.patch("/api/v1/menus/99999/translations/en", json={"sections": [], "wines": []})
    assert resp.status_code == 404


def test_save_translation_invalidates_menu_cache(client, test_db, monkeypatch):
    """PATCH /translations/en calls invalidate_menu_cache for the slug."""
    import app.core.redis as redis_core
    invalidate_mock = AsyncMock()
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", invalidate_mock)

    menu_id = _create_menu(test_db)
    client.patch(f"/api/v1/menus/{menu_id}/translations/en", json={"sections": [], "wines": []})

    invalidate_mock.assert_called_once_with("le-bistrot-test")


# ---------------------------------------------------------------------------
# Bulk translate endpoint: POST /api/v1/menus/{id}/translate/all
# ---------------------------------------------------------------------------

def test_bulk_translate_all_languages(client, test_db):
    """POST /translate/all translates to all 3 languages and returns summary."""
    menu_id = _create_menu(test_db)

    with patch("app.routers.menu.translate_menu", return_value=MOCK_EN_TRANSLATION):
        resp = client.post(f"/api/v1/menus/{menu_id}/translate/all")

    assert resp.status_code == 200
    body = resp.json()
    assert body["menu_id"] == menu_id
    assert set(body["languages"]) == {"en", "fr", "es"}


def test_bulk_translate_stores_all_in_db(client, test_db):
    """POST /translate/all stores translations for en, fr, es in menu_data."""
    menu_id = _create_menu(test_db)

    with patch("app.routers.menu.translate_menu", return_value=MOCK_EN_TRANSLATION):
        resp = client.post(f"/api/v1/menus/{menu_id}/translate/all")

    assert resp.status_code == 200

    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    data = json.loads(menu.menu_data)
    session.close()

    assert "translations" in data
    for lang in ("en", "fr", "es"):
        assert lang in data["translations"]


def test_bulk_translate_not_found_returns_404(client):
    """POST /translate/all for unknown menu_id → 404."""
    with patch("app.routers.menu.translate_menu", return_value={"sections": [], "wines": []}):
        resp = client.post("/api/v1/menus/99999/translate/all")
    assert resp.status_code == 404
