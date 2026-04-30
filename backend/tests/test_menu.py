"""
Tests for menu endpoints:
  POST  /api/v1/menus/upload              — file upload (PDF / image), OCR queued
  GET   /api/v1/menus/{id}/status        — poll OCR status
  GET   /api/v1/menus/{id}              — editor view
  PATCH /api/v1/menus/{id}              — save sections / wines
  PATCH /api/v1/menus/{id}/publish      — toggle draft / published
  PATCH /api/v1/menus/{id}/translate    — auto-translate one language
  PATCH /api/v1/menus/{id}/translations/{lang} — save manual translation
  POST  /api/v1/menus/{id}/translate/all — bulk translate all languages
  POST  /api/v1/menus/{id}/duplicate    — clone a menu
"""

import io
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import Menu
from tests.conftest import seed_menu


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_PDF_MAGIC = b"%PDF-1.4 fake pdf content with enough bytes " + b"x" * 200
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"x" * 200
_JPEG_MAGIC = b"\xff\xd8\xff\xe0" + b"x" * 200


def _upload(client, content: bytes, filename: str, restaurant_name: str = "Test Resto", restaurant_id: str | None = None):
    data = {"restaurant_name": restaurant_name}
    if restaurant_id:
        data["restaurant_id"] = restaurant_id
    return client.post(
        "/api/v1/menus/upload",
        data=data,
        files={"file": (filename, io.BytesIO(content), "application/octet-stream")},
    )


# ---------------------------------------------------------------------------
# POST /api/v1/menus/upload — validation
# ---------------------------------------------------------------------------

def test_upload_pdf_returns_202(client, monkeypatch):
    """Valid PDF upload returns 202 with menu_id, slug, status=processing."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=None))

    resp = _upload(client, _PDF_MAGIC, "menu.pdf")
    assert resp.status_code == 202
    body = resp.json()
    assert "menu_id" in body
    assert "slug" in body
    assert body["status"] in ("processing", "ready")


def test_upload_png_returns_202(client, monkeypatch):
    """PNG image upload is accepted (returns 202)."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=None))

    resp = _upload(client, _PNG_MAGIC, "menu.png")
    assert resp.status_code == 202


def test_upload_jpeg_returns_202(client, monkeypatch):
    """JPEG image upload is accepted (returns 202)."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=None))

    resp = _upload(client, _JPEG_MAGIC, "menu.jpg")
    assert resp.status_code == 202


def test_upload_empty_file_returns_400(client):
    """Empty file (< 100 bytes) → 400."""
    resp = _upload(client, b"short", "menu.pdf")
    assert resp.status_code == 400


def test_upload_file_too_large_returns_400(client):
    """File larger than 20 MB → 400."""
    big = b"x" * (21 * 1024 * 1024)
    resp = _upload(client, big, "huge.pdf")
    assert resp.status_code == 400


def test_upload_invalid_file_type_returns_400(client):
    """Non-PDF/image binary → 400."""
    garbage = b"\x00\x01\x02" + b"x" * 200
    resp = _upload(client, garbage, "menu.txt")
    assert resp.status_code == 400


def test_upload_ocr_cache_hit_returns_ready(client, monkeypatch):
    """When OCR cache hit exists, status='ready' immediately."""
    import app.core.redis as redis_core
    cached = {
        "restaurant_name": "Cached Resto",
        "sections": [{"title": "Main", "items": []}],
        "wines": [],
    }
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=cached))

    resp = _upload(client, _PDF_MAGIC, "cached.pdf")
    assert resp.status_code == 202
    assert resp.json()["status"] == "ready"


def test_upload_creates_menu_in_db(client, monkeypatch, test_db):
    """Upload persists a Menu row in the database."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=None))

    resp = _upload(client, _PDF_MAGIC, "menu.pdf", restaurant_name="DB Persist Resto")
    assert resp.status_code == 202
    menu_id = resp.json()["menu_id"]

    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()

    assert menu is not None
    assert menu.restaurant_name == "DB Persist Resto"


# ---------------------------------------------------------------------------
# GET /api/v1/menus/{id}/status
# ---------------------------------------------------------------------------

def test_get_status_returns_processing(client, test_db):
    """Status endpoint returns 'processing' for a menu still in OCR."""
    menu_id = seed_menu(test_db, status="processing", slug="status-test-proc")

    resp = client.get(f"/api/v1/menus/{menu_id}/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "processing"
    assert resp.json()["menu_id"] == menu_id


def test_get_status_returns_ready_with_data(client, test_db):
    """Status endpoint for 'ready' menu includes menu_data."""
    menu_id = seed_menu(test_db, status="ready", slug="status-test-ready")

    resp = client.get(f"/api/v1/menus/{menu_id}/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert "menu_data" in body
    assert body["menu_data"] is not None


def test_get_status_not_found_returns_404(client):
    """Polling status for a non-existent menu → 404."""
    resp = client.get("/api/v1/menus/99999/status")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/v1/menus/{id} — editor view
# ---------------------------------------------------------------------------

def test_get_menu_for_editor(client, test_db):
    """GET /menus/{id} returns sections, wines, slug, publish_status."""
    menu_id = seed_menu(test_db, slug="editor-test")

    resp = client.get(f"/api/v1/menus/{menu_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["menu_id"] == menu_id
    assert body["slug"] == "editor-test"
    assert "sections" in body
    assert "wines" in body
    assert body["publish_status"] == "draft"


def test_get_menu_not_found_returns_404(client):
    """GET /menus/99999 → 404."""
    resp = client.get("/api/v1/menus/99999")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/v1/menus/{id} — save editor changes
# ---------------------------------------------------------------------------

def test_update_menu_sections(client, test_db, monkeypatch):
    """PATCH saves new sections to menu_data and returns slug."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="update-test")
    new_sections = [
        {
            "title": "Plats",
            "items": [
                {"name": "Steak", "price": 24.0, "allergens": [], "tags": ["meat"]},
            ],
        }
    ]
    resp = client.patch(f"/api/v1/menus/{menu_id}", json={"sections": new_sections})
    assert resp.status_code == 200
    assert resp.json()["slug"] == "update-test"

    # Verify DB was updated
    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    data = json.loads(menu.menu_data)
    session.close()
    assert data["sections"][0]["title"] == "Plats"


def test_update_menu_restaurant_name(client, test_db, monkeypatch):
    """PATCH updates restaurant_name on the Menu model."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="rename-test")
    resp = client.patch(f"/api/v1/menus/{menu_id}", json={"restaurant_name": "Nouveau Nom"})
    assert resp.status_code == 200

    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()
    assert menu.restaurant_name == "Nouveau Nom"


def test_update_menu_not_found_returns_404(client, monkeypatch):
    """PATCH on non-existent menu → 404."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    resp = client.patch("/api/v1/menus/99999", json={"sections": []})
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/v1/menus/{id}/publish
# ---------------------------------------------------------------------------

def test_publish_menu(client, test_db, monkeypatch):
    """PATCH /publish?publish_status=published sets publish_status."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="publish-test")
    resp = client.patch(f"/api/v1/menus/{menu_id}/publish?publish_status=published")
    assert resp.status_code == 200
    assert resp.json()["publish_status"] == "published"


def test_unpublish_menu(client, test_db, monkeypatch):
    """PATCH /publish?publish_status=draft sets publish_status back to draft."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="unpublish-test", publish_status="published")
    resp = client.patch(f"/api/v1/menus/{menu_id}/publish?publish_status=draft")
    assert resp.status_code == 200
    assert resp.json()["publish_status"] == "draft"


def test_publish_invalid_status_returns_400(client, test_db, monkeypatch):
    """Invalid publish_status value → 400."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="bad-publish-test")
    resp = client.patch(f"/api/v1/menus/{menu_id}/publish?publish_status=invalid")
    assert resp.status_code == 400


def test_publish_not_found_returns_404(client, monkeypatch):
    """PATCH /publish on non-existent menu → 404."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    resp = client.patch("/api/v1/menus/99999/publish?publish_status=published")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# PATCH /api/v1/menus/{id}/translate — auto-translate via Gemini
# ---------------------------------------------------------------------------

def _fake_translate(menu: dict, lang: str) -> dict:
    """Fake translate_menu: returns sections/wines unchanged."""
    return {"sections": menu.get("sections", []), "wines": menu.get("wines", [])}


def test_translate_menu_en(client, test_db, monkeypatch):
    """PATCH /translate?lang=en returns translated sections."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="translate-en-test")

    with patch("app.routers.menu.translate_menu", side_effect=_fake_translate):
        resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=en")

    assert resp.status_code == 200
    body = resp.json()
    assert body["lang"] == "en"
    assert "sections" in body


def test_translate_invalid_lang_returns_400(client, test_db):
    """PATCH /translate?lang=de → 400 (only en/fr/es supported)."""
    menu_id = seed_menu(test_db, slug="translate-bad-lang")
    resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=de")
    assert resp.status_code == 400


def test_translate_not_found_returns_404(client, monkeypatch):
    """PATCH /translate on non-existent menu → 404."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())

    with patch("app.routers.menu.translate_menu", side_effect=_fake_translate):
        resp = client.patch("/api/v1/menus/99999/translate?lang=en")
    assert resp.status_code == 404


def test_translate_uses_cache_when_available(client, test_db, monkeypatch):
    """If translation cache exists, Gemini is NOT called."""
    import app.core.redis as redis_core
    cached_translation = {"sections": [{"title": "Starters", "items": []}], "wines": []}
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=cached_translation))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="translate-cache-hit")

    with patch("app.routers.menu.translate_menu") as mock_translate:
        resp = client.patch(f"/api/v1/menus/{menu_id}/translate?lang=en")
        mock_translate.assert_not_called()

    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# PATCH /api/v1/menus/{id}/translations/{lang} — save manual override
# ---------------------------------------------------------------------------

def test_save_manual_translation(client, test_db, monkeypatch):
    """PATCH /translations/fr saves the manual translation to menu_data."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="manual-translate-test")
    body = {
        "sections": [{"title": "Entrées", "items": [{"name": "Soupe", "price": 7.0, "allergens": [], "tags": []}]}],
        "wines": [],
    }
    resp = client.patch(f"/api/v1/menus/{menu_id}/translations/fr", json=body)
    assert resp.status_code == 200
    assert resp.json()["lang"] == "fr"

    # Verify stored in DB
    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    data = json.loads(menu.menu_data)
    session.close()
    assert "fr" in data["translations"]
    assert data["translations"]["fr"]["sections"][0]["title"] == "Entrées"


def test_save_manual_translation_invalid_lang_returns_400(client, test_db):
    """Invalid lang (e.g. 'it') → 400."""
    menu_id = seed_menu(test_db, slug="manual-bad-lang")
    resp = client.patch(f"/api/v1/menus/{menu_id}/translations/it", json={"sections": [], "wines": []})
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/v1/menus/{id}/translate/all — bulk translate
# ---------------------------------------------------------------------------

def test_bulk_translate_all_languages(client, test_db, monkeypatch):
    """POST /translate/all translates en/fr/es and returns completed=[en,fr,es]."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="bulk-translate-test")

    with patch("app.routers.menu.translate_menu", side_effect=_fake_translate):
        resp = client.post(f"/api/v1/menus/{menu_id}/translate/all")

    assert resp.status_code == 200
    body = resp.json()
    assert set(body["languages"]) == {"en", "fr", "es"}
    assert body["errors"] == {}


def test_bulk_translate_not_found_returns_404(client, monkeypatch):
    """POST /translate/all on non-existent menu → 404."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    with patch("app.routers.menu.translate_menu", side_effect=_fake_translate):
        resp = client.post("/api/v1/menus/99999/translate/all")
    assert resp.status_code == 404


def test_bulk_translate_partial_failure_reported(client, test_db, monkeypatch):
    """If one language fails, it appears in 'errors', others succeed."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_translation_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_translation_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    menu_id = seed_menu(test_db, slug="bulk-partial-fail")

    call_count = {"n": 0}

    def flaky_translate(menu: dict, lang: str) -> dict:
        call_count["n"] += 1
        if lang == "es":
            raise RuntimeError("Gemini rate limit")
        return {"sections": menu.get("sections", []), "wines": []}

    with patch("app.routers.menu.translate_menu", side_effect=flaky_translate):
        resp = client.post(f"/api/v1/menus/{menu_id}/translate/all")

    assert resp.status_code == 200
    body = resp.json()
    assert "es" in body["errors"]
    assert "en" in body["languages"]
    assert "fr" in body["languages"]


# ---------------------------------------------------------------------------
# POST /api/v1/menus/{id}/duplicate
# ---------------------------------------------------------------------------

def test_duplicate_menu_returns_201(client, test_db):
    """POST /duplicate returns 201 with a new slug ending in -copy."""
    menu_id = seed_menu(test_db, slug="original-menu")
    resp = client.post(f"/api/v1/menus/{menu_id}/duplicate")
    assert resp.status_code == 201
    body = resp.json()
    assert body["slug"] == "original-menu-copy"


def test_duplicate_menu_creates_new_db_row(client, test_db):
    """Duplicate creates a distinct Menu row with a new id."""
    menu_id = seed_menu(test_db, slug="dup-source")
    resp = client.post(f"/api/v1/menus/{menu_id}/duplicate")
    new_id = resp.json()["menu_id"]
    assert new_id != menu_id


def test_duplicate_menu_starts_as_draft(client, test_db):
    """Duplicated menu always starts with publish_status='draft'."""
    menu_id = seed_menu(test_db, slug="dup-published", publish_status="published")
    client.post(f"/api/v1/menus/{menu_id}/duplicate")

    session = test_db()
    copy = session.query(Menu).filter(Menu.slug == "dup-published-copy").first()
    session.close()
    assert copy.publish_status == "draft"


def test_duplicate_menu_handles_slug_collision(client, test_db):
    """If -copy slug already exists, duplicate gets -copy-2."""
    menu_id = seed_menu(test_db, slug="my-menu")
    # First duplicate → my-menu-copy
    client.post(f"/api/v1/menus/{menu_id}/duplicate")
    # Second duplicate → my-menu-copy-2
    resp = client.post(f"/api/v1/menus/{menu_id}/duplicate")
    assert resp.json()["slug"] == "my-menu-copy-2"


def test_duplicate_not_found_returns_404(client):
    """POST /duplicate on non-existent menu → 404."""
    resp = client.post("/api/v1/menus/99999/duplicate")
    assert resp.status_code == 404
