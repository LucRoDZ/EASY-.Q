"""
Tests for OCR upload flow end-to-end:
  POST /api/v1/menus/upload → background OCR → GET status → GET editor
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

# Minimal valid PDF (magic bytes + padding)
MINIMAL_PDF = b"%PDF-1.4\n" + b"0" * 200

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
        }
    ],
    "wines": [
        {"name": "Bordeaux Rouge", "type": "red", "price": 28.0, "pairing_tags": ["meat"]}
    ],
}


@pytest.fixture(scope="function")
def test_db():
    """In-memory SQLite DB + override FastAPI get_db dependency."""
    # StaticPool ensures the same in-memory connection is reused across threads
    # (required for SQLite :memory: + TestClient which runs in a separate thread)
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
    """TestClient with Redis completely mocked (no real Redis needed)."""
    import app.core.redis as redis_core

    monkeypatch.setattr(redis_core, "init_redis", AsyncMock())
    monkeypatch.setattr(redis_core, "close_redis", AsyncMock())
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=None))
    monkeypatch.setattr(redis_core, "set_ocr_cache", AsyncMock())
    monkeypatch.setattr(redis_core, "invalidate_menu_cache", AsyncMock())

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------------------
# Upload endpoint — file validation
# ---------------------------------------------------------------------------

def test_upload_file_too_small(client):
    """Files < 100 bytes → 400."""
    resp = client.post(
        "/api/v1/menus/upload",
        data={"restaurant_name": "Test"},
        files={"file": ("menu.pdf", b"%PDF-1.4", "application/pdf")},
    )
    assert resp.status_code == 400
    assert "too small" in resp.json()["detail"].lower()


def test_upload_file_too_large(client):
    """Files > 20 MB → 400."""
    large = b"%PDF-1.4\n" + b"0" * (21 * 1024 * 1024)
    resp = client.post(
        "/api/v1/menus/upload",
        data={"restaurant_name": "Test"},
        files={"file": ("menu.pdf", large, "application/pdf")},
    )
    assert resp.status_code == 400
    assert "large" in resp.json()["detail"].lower()


def test_upload_invalid_file_type_rejected(client):
    """Non-PDF/image files → 400."""
    fake_txt = b"This is plain text, not a menu" + b"x" * 100
    resp = client.post(
        "/api/v1/menus/upload",
        data={"restaurant_name": "Test"},
        files={"file": ("menu.txt", fake_txt, "text/plain")},
    )
    assert resp.status_code == 400
    assert "invalid" in resp.json()["detail"].lower()


# ---------------------------------------------------------------------------
# Upload endpoint — happy paths
# ---------------------------------------------------------------------------

def test_upload_valid_pdf_returns_202(client, test_db):
    """Valid PDF → 202 with menu_id, slug, status=processing."""
    with patch("app.routers.menu.save_pdf", return_value="/tmp/test.pdf"):
        resp = client.post(
            "/api/v1/menus/upload",
            data={"restaurant_name": "Le Bistrot"},
            files={"file": ("menu.pdf", MINIMAL_PDF, "application/pdf")},
        )

    assert resp.status_code == 202
    body = resp.json()
    assert "menu_id" in body
    assert "slug" in body
    assert body["status"] == "processing"


def test_upload_creates_menu_record_in_db(client, test_db):
    """Uploaded menu is persisted in DB with status=processing."""
    with patch("app.routers.menu.save_pdf", return_value="/tmp/test.pdf"):
        resp = client.post(
            "/api/v1/menus/upload",
            data={"restaurant_name": "Chez Paul"},
            files={"file": ("menu.pdf", MINIMAL_PDF, "application/pdf")},
        )

    assert resp.status_code == 202
    menu_id = resp.json()["menu_id"]

    session = test_db()
    menu = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()

    assert menu is not None
    assert menu.restaurant_name == "Chez Paul"
    assert menu.status == "processing"


def test_upload_jpeg_accepted(client, test_db):
    """JPEG (magic bytes \\xff\\xd8\\xff) accepted → 202."""
    fake_jpeg = b"\xff\xd8\xff" + b"\x00" * 200
    with patch("app.routers.menu.save_pdf", return_value="/tmp/test.jpg"):
        resp = client.post(
            "/api/v1/menus/upload",
            data={"restaurant_name": "Sushi Bar"},
            files={"file": ("menu.jpg", fake_jpeg, "image/jpeg")},
        )
    assert resp.status_code == 202


def test_upload_png_accepted(client, test_db):
    """PNG (magic bytes \\x89PNG) accepted → 202."""
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 200
    with patch("app.routers.menu.save_pdf", return_value="/tmp/test.png"):
        resp = client.post(
            "/api/v1/menus/upload",
            data={"restaurant_name": "Pizzeria"},
            files={"file": ("menu.png", fake_png, "image/png")},
        )
    assert resp.status_code == 202


def test_upload_cache_hit_returns_ready_immediately(client, test_db, monkeypatch):
    """Redis OCR cache hit → status=ready without background OCR."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_ocr_cache", AsyncMock(return_value=MOCK_MENU_DATA))

    with patch("app.routers.menu.save_pdf", return_value="/tmp/cached.pdf"):
        resp = client.post(
            "/api/v1/menus/upload",
            data={"restaurant_name": "Cached Bistrot"},
            files={"file": ("menu.pdf", MINIMAL_PDF, "application/pdf")},
        )

    assert resp.status_code == 202
    assert resp.json()["status"] == "ready"


# ---------------------------------------------------------------------------
# Status polling endpoint
# ---------------------------------------------------------------------------

def test_get_status_processing(client, test_db):
    """GET /status returns status=processing and no menu_data yet."""
    session = test_db()
    menu = Menu(
        restaurant_name="In Progress",
        slug="in-progress-slug",
        pdf_path="/tmp/x.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="processing",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    resp = client.get(f"/api/v1/menus/{menu_id}/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "processing"
    assert body["menu_data"] is None
    assert body["ocr_error"] is None


def test_get_status_ready_returns_menu_data(client, test_db):
    """GET /status returns status=ready with full menu_data."""
    session = test_db()
    menu = Menu(
        restaurant_name="Le Bistrot",
        slug="le-bistrot-ready",
        pdf_path="/tmp/x.pdf",
        languages="en,fr,es",
        menu_data=json.dumps(MOCK_MENU_DATA),
        status="ready",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    resp = client.get(f"/api/v1/menus/{menu_id}/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["menu_data"] is not None
    assert body["menu_data"]["restaurant_name"] == "Le Bistrot Test"
    assert len(body["menu_data"]["sections"]) == 1


def test_get_status_error_includes_error_message(client, test_db):
    """GET /status returns status=error with ocr_error."""
    session = test_db()
    menu = Menu(
        restaurant_name="Error Menu",
        slug="error-menu-slug",
        pdf_path="/tmp/x.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="error",
        ocr_error="Gemini API timeout after 30s",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    resp = client.get(f"/api/v1/menus/{menu_id}/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "error"
    assert body["ocr_error"] == "Gemini API timeout after 30s"
    assert body["menu_data"] is None


def test_get_status_not_found(client):
    """GET /status for unknown menu_id → 404."""
    resp = client.get("/api/v1/menus/99999/status")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Menu editor endpoint
# ---------------------------------------------------------------------------

def test_get_editor_returns_sections_and_wines(client, test_db):
    """GET /{id} returns sections, wines, and metadata for the editor."""
    session = test_db()
    menu = Menu(
        restaurant_name="Editor Test",
        slug="editor-test",
        pdf_path="/tmp/x.pdf",
        languages="en,fr,es",
        menu_data=json.dumps(MOCK_MENU_DATA),
        status="ready",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    resp = client.get(f"/api/v1/menus/{menu_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ready"
    assert body["restaurant_name"] == "Editor Test"
    assert len(body["sections"]) == 1
    assert body["sections"][0]["title"] == "Entrées"
    assert body["sections"][0]["items"][0]["name"] == "Salade César"
    assert body["wines"][0]["name"] == "Bordeaux Rouge"


def test_get_editor_not_found(client):
    """GET /{id} for unknown menu → 404."""
    resp = client.get("/api/v1/menus/99999")
    assert resp.status_code == 404


def test_get_editor_empty_data(client, test_db):
    """GET /{id} for menu still processing returns empty sections/wines."""
    session = test_db()
    menu = Menu(
        restaurant_name="Empty",
        slug="empty-data-test",
        pdf_path="/tmp/x.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="processing",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    resp = client.get(f"/api/v1/menus/{menu_id}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["sections"] == []
    assert body["wines"] == []


# ---------------------------------------------------------------------------
# Background OCR task (unit tests)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_background_ocr_task_updates_db_to_ready(test_db, monkeypatch):
    """_run_ocr_background sets status=ready and stores menu_data in DB."""
    import app.core.redis as redis_core
    import app.routers.menu as menu_router

    # Insert a processing menu
    session = test_db()
    menu = Menu(
        restaurant_name="OCR Test",
        slug="ocr-bg-ready",
        pdf_path="/tmp/ocr_test.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="processing",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    # Mock OCR service (patch on the menu_router module namespace)
    monkeypatch.setattr(menu_router, "extract_menu_from_pdf", MagicMock(return_value=MOCK_MENU_DATA))
    monkeypatch.setattr(menu_router, "translate_menu", MagicMock(side_effect=lambda m, _lang: m))
    monkeypatch.setattr(redis_core, "set_ocr_cache", AsyncMock())
    # Redirect SessionLocal to the test DB factory
    monkeypatch.setattr(menu_router, "SessionLocal", test_db)

    await menu_router._run_ocr_background(
        menu_id=menu_id,
        file_path="/tmp/ocr_test.pdf",
        sha256="abc123deadbeef",
        restaurant_name="OCR Test",
    )

    session = test_db()
    updated = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()

    assert updated.status == "ready"
    data = json.loads(updated.menu_data)
    assert data["restaurant_name"] == "Le Bistrot Test"
    assert len(data["sections"]) == 1
    assert "translations" in data


@pytest.mark.asyncio
async def test_background_ocr_task_sets_error_on_failure(test_db, monkeypatch):
    """_run_ocr_background sets status=error when OCR raises an exception (all 3 retries)."""
    import app.core.redis as redis_core
    import app.routers.menu as menu_router

    session = test_db()
    menu = Menu(
        restaurant_name="OCR Fail",
        slug="ocr-bg-fail",
        pdf_path="/tmp/fail.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="processing",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    monkeypatch.setattr(
        menu_router,
        "extract_menu_from_pdf",
        MagicMock(side_effect=Exception("Gemini API unavailable")),
    )
    monkeypatch.setattr(redis_core, "set_ocr_cache", AsyncMock())
    monkeypatch.setattr(menu_router, "SessionLocal", test_db)
    # Patch sleep so test runs fast
    monkeypatch.setattr("asyncio.sleep", AsyncMock())

    await menu_router._run_ocr_background(
        menu_id=menu_id,
        file_path="/tmp/fail.pdf",
        sha256="def456",
        restaurant_name="OCR Fail",
    )

    session = test_db()
    updated = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()

    assert updated.status == "error"
    assert "Gemini API unavailable" in updated.ocr_error


@pytest.mark.asyncio
async def test_background_ocr_retries_three_times_on_persistent_failure(test_db, monkeypatch):
    """_run_ocr_background calls extract_menu_from_pdf exactly 3 times when it always fails."""
    import app.core.redis as redis_core
    import app.routers.menu as menu_router

    session = test_db()
    menu = Menu(
        restaurant_name="Retry Test",
        slug="ocr-retry-fail",
        pdf_path="/tmp/retry.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="processing",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    ocr_mock = MagicMock(side_effect=Exception("timeout"))
    sleep_mock = AsyncMock()
    monkeypatch.setattr(menu_router, "extract_menu_from_pdf", ocr_mock)
    monkeypatch.setattr(redis_core, "set_ocr_cache", AsyncMock())
    monkeypatch.setattr(menu_router, "SessionLocal", test_db)
    monkeypatch.setattr("asyncio.sleep", sleep_mock)

    await menu_router._run_ocr_background(
        menu_id=menu_id,
        file_path="/tmp/retry.pdf",
        sha256="retry123",
        restaurant_name="Retry Test",
    )

    # OCR attempted exactly 3 times
    assert ocr_mock.call_count == 3
    # Backoff sleep called twice (after attempt 0 → 1s, after attempt 1 → 2s; not after last attempt)
    assert sleep_mock.call_count == 2
    sleep_calls = [c.args[0] for c in sleep_mock.call_args_list]
    assert sleep_calls == [1, 2]  # 2^0, 2^1


@pytest.mark.asyncio
async def test_background_ocr_succeeds_on_second_attempt(test_db, monkeypatch):
    """_run_ocr_background returns ready if OCR succeeds on the second attempt."""
    import app.core.redis as redis_core
    import app.routers.menu as menu_router

    session = test_db()
    menu = Menu(
        restaurant_name="Retry Success",
        slug="ocr-retry-ok",
        pdf_path="/tmp/retry_ok.pdf",
        languages="en,fr,es",
        menu_data="{}",
        status="processing",
    )
    session.add(menu)
    session.commit()
    menu_id = menu.id
    session.close()

    # Fail once, then succeed
    ocr_mock = MagicMock(side_effect=[Exception("transient error"), MOCK_MENU_DATA])
    sleep_mock = AsyncMock()
    monkeypatch.setattr(menu_router, "extract_menu_from_pdf", ocr_mock)
    monkeypatch.setattr(menu_router, "translate_menu", MagicMock(side_effect=lambda m, _lang: m))
    monkeypatch.setattr(redis_core, "set_ocr_cache", AsyncMock())
    monkeypatch.setattr(menu_router, "SessionLocal", test_db)
    monkeypatch.setattr("asyncio.sleep", sleep_mock)

    await menu_router._run_ocr_background(
        menu_id=menu_id,
        file_path="/tmp/retry_ok.pdf",
        sha256="retryok456",
        restaurant_name="Retry Success",
    )

    assert ocr_mock.call_count == 2  # Failed once, succeeded second
    assert sleep_mock.call_count == 1  # Slept once after first failure (2^0 = 1s)
    assert sleep_mock.call_args_list[0].args[0] == 1

    session = test_db()
    updated = session.query(Menu).filter(Menu.id == menu_id).first()
    session.close()

    assert updated.status == "ready"
    assert updated.ocr_error is None
