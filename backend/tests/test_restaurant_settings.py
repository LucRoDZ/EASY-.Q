"""
Tests for restaurant settings endpoints:
  GET   /api/v1/restaurants/{slug}       — get or auto-create profile
  PATCH /api/v1/restaurants/{slug}       — update name, address, phone, hours, timezone, social
  POST  /api/v1/restaurants/{slug}/logo  — upload + resize logo image
"""

import io
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import RestaurantProfile


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


def _create_profile(test_db, slug="le-bistrot", name="Le Bistrot") -> None:
    session = test_db()
    profile = RestaurantProfile(slug=slug, name=name)
    session.add(profile)
    session.commit()
    session.close()


def _minimal_jpeg() -> bytes:
    """Create a minimal valid JPEG using Pillow in memory."""
    from PIL import Image
    img = Image.new("RGB", (100, 100), color=(200, 100, 50))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def _minimal_png() -> bytes:
    from PIL import Image
    img = Image.new("RGB", (800, 600), color=(50, 100, 200))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# GET /{slug} — profile retrieval and auto-creation
# ---------------------------------------------------------------------------

def test_get_profile_auto_creates_if_missing(client):
    """GET /restaurants/{slug} creates a blank profile if it doesn't exist."""
    resp = client.get("/api/v1/restaurants/new-restaurant")
    assert resp.status_code == 200
    body = resp.json()
    assert body["slug"] == "new-restaurant"
    assert body["name"] == "new-restaurant"  # seeded from slug


def test_get_profile_returns_existing_data(client, test_db):
    """GET /restaurants/{slug} returns the stored profile."""
    session = test_db()
    profile = RestaurantProfile(
        slug="chez-paul",
        name="Chez Paul",
        address="12 rue de la Paix, Paris",
        phone="+33 1 23 45 67 89",
    )
    session.add(profile)
    session.commit()
    session.close()

    resp = client.get("/api/v1/restaurants/chez-paul")
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Chez Paul"
    assert body["address"] == "12 rue de la Paix, Paris"
    assert body["phone"] == "+33 1 23 45 67 89"


# ---------------------------------------------------------------------------
# PATCH /{slug} — partial updates
# ---------------------------------------------------------------------------

def test_patch_profile_updates_name(client, test_db):
    """PATCH /restaurants/{slug} updates restaurant name."""
    _create_profile(test_db, "sushi-bar", "Sushi Bar")
    resp = client.patch("/api/v1/restaurants/sushi-bar", json={"name": "Sushi Bar Premium"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Sushi Bar Premium"


def test_patch_profile_updates_address(client, test_db):
    """PATCH /restaurants/{slug} updates address field."""
    _create_profile(test_db, "pizza-roma", "Pizza Roma")
    resp = client.patch(
        "/api/v1/restaurants/pizza-roma",
        json={"address": "5 avenue Victor Hugo, Lyon"},
    )
    assert resp.status_code == 200
    assert resp.json()["address"] == "5 avenue Victor Hugo, Lyon"


def test_patch_profile_updates_phone(client, test_db):
    """PATCH /restaurants/{slug} updates phone field."""
    _create_profile(test_db, "le-zinc", "Le Zinc")
    resp = client.patch("/api/v1/restaurants/le-zinc", json={"phone": "+33 4 56 78 90 12"})
    assert resp.status_code == 200
    assert resp.json()["phone"] == "+33 4 56 78 90 12"


def test_patch_profile_updates_opening_hours(client, test_db):
    """PATCH /restaurants/{slug} stores opening hours JSONB."""
    _create_profile(test_db, "brasserie-du-port", "Brasserie du Port")
    hours = {
        "lundi": {"open": "12:00", "close": "23:00", "closed": False},
        "dimanche": {"open": "12:00", "close": "16:00", "closed": False},
        "mardi": {"open": "00:00", "close": "00:00", "closed": True},
    }
    resp = client.patch("/api/v1/restaurants/brasserie-du-port", json={"opening_hours": hours})
    assert resp.status_code == 200
    body = resp.json()
    assert body["opening_hours"]["lundi"]["open"] == "12:00"
    assert body["opening_hours"]["mardi"]["closed"] is True


def test_patch_profile_updates_timezone(client, test_db):
    """PATCH /restaurants/{slug} stores timezone string."""
    _create_profile(test_db, "tz-test", "TZ Test")
    resp = client.patch("/api/v1/restaurants/tz-test", json={"timezone": "Europe/Paris"})
    assert resp.status_code == 200
    assert resp.json()["timezone"] == "Europe/Paris"


def test_patch_profile_updates_social_links(client, test_db):
    """PATCH /restaurants/{slug} stores social media links."""
    _create_profile(test_db, "social-test", "Social Test")
    social = {
        "instagram": "https://instagram.com/bistrot",
        "facebook": "https://facebook.com/bistrot",
        "google_maps": "https://maps.google.com/bistrot",
    }
    resp = client.patch("/api/v1/restaurants/social-test", json={"social_links": social})
    assert resp.status_code == 200
    body = resp.json()
    assert body["social_links"]["instagram"] == "https://instagram.com/bistrot"
    assert body["social_links"]["facebook"] == "https://facebook.com/bistrot"


def test_patch_profile_updates_google_place_id(client, test_db):
    """PATCH /restaurants/{slug} stores Google Place ID for review CTA."""
    _create_profile(test_db, "google-place-test", "Google Place Test")
    place_id = "ChIJN1t_tDeuEmsRUsoyG83frY4"
    resp = client.patch(
        "/api/v1/restaurants/google-place-test",
        json={"google_place_id": place_id},
    )
    assert resp.status_code == 200
    assert resp.json()["google_place_id"] == place_id


def test_patch_profile_clears_google_place_id(client, test_db):
    """PATCH /restaurants/{slug} with google_place_id=null clears the field."""
    session = test_db()
    profile = RestaurantProfile(
        slug="clear-place-id",
        name="Clear Place ID",
        google_place_id="ChIJN1t_tDeuEmsRUsoyG83frY4",
    )
    session.add(profile)
    session.commit()
    session.close()

    resp = client.patch("/api/v1/restaurants/clear-place-id", json={"google_place_id": None})
    assert resp.status_code == 200
    assert resp.json()["google_place_id"] is None


def test_patch_profile_partial_update_preserves_other_fields(client, test_db):
    """PATCH only changes specified fields; other fields remain unchanged."""
    session = test_db()
    profile = RestaurantProfile(
        slug="partial-test",
        name="Original Name",
        address="Original Address",
        phone="+33 1 00 00 00 00",
    )
    session.add(profile)
    session.commit()
    session.close()

    resp = client.patch("/api/v1/restaurants/partial-test", json={"name": "New Name"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "New Name"
    assert body["address"] == "Original Address"  # preserved
    assert body["phone"] == "+33 1 00 00 00 00"  # preserved


def test_patch_profile_auto_creates_and_sets_fields(client):
    """PATCH /restaurants/{slug} creates profile if missing, then sets fields."""
    resp = client.patch(
        "/api/v1/restaurants/brand-new",
        json={"name": "Brand New Restaurant", "phone": "+33 9 87 65 43 21"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "Brand New Restaurant"
    assert body["phone"] == "+33 9 87 65 43 21"


# ---------------------------------------------------------------------------
# POST /{slug}/logo — logo upload with resize
# ---------------------------------------------------------------------------

def test_logo_upload_jpeg_returns_logo_url(client, test_db):
    """POST /{slug}/logo with a JPEG → 200 with logo_url."""
    _create_profile(test_db, "logo-test", "Logo Test")
    jpeg_data = _minimal_jpeg()

    with patch("app.routers.restaurants.r2.storage_configured", return_value=False), \
         patch("app.routers.restaurants._LOGO_DIR") as mock_dir:
        mock_path = MagicMock()
        mock_path.__truediv__ = MagicMock(return_value=mock_path)
        mock_path.write_bytes = MagicMock()
        mock_dir.__truediv__ = MagicMock(return_value=mock_path)

        resp = client.post(
            "/api/v1/restaurants/logo-test/logo",
            files={"file": ("logo.jpg", jpeg_data, "image/jpeg")},
        )

    assert resp.status_code == 200
    assert "logo_url" in resp.json()


def test_logo_upload_invalid_type_rejected(client, test_db):
    """POST /{slug}/logo with text/plain → 400."""
    _create_profile(test_db, "logo-bad-type", "Bad Type")
    resp = client.post(
        "/api/v1/restaurants/logo-bad-type/logo",
        files={"file": ("logo.txt", b"not an image", "text/plain")},
    )
    assert resp.status_code == 400
    assert "invalid" in resp.json()["detail"].lower()


def test_logo_upload_too_large_rejected(client, test_db):
    """POST /{slug}/logo > 5MB → 400."""
    _create_profile(test_db, "logo-large", "Large Logo")
    large_data = b"\xff\xd8\xff" + b"\x00" * (6 * 1024 * 1024)
    resp = client.post(
        "/api/v1/restaurants/logo-large/logo",
        files={"file": ("logo.jpg", large_data, "image/jpeg")},
    )
    assert resp.status_code == 400
    assert "large" in resp.json()["detail"].lower()


def test_logo_upload_png_resized_to_512(client, test_db):
    """POST /{slug}/logo with oversized PNG → gets resized to max 512x512."""
    _create_profile(test_db, "logo-resize", "Resize Test")
    png_data = _minimal_png()  # 800x600 PNG

    written_data = {}

    def fake_write_bytes(data):
        written_data["bytes"] = data

    with patch("app.routers.restaurants.r2.storage_configured", return_value=False):
        with patch("app.routers.restaurants._LOGO_DIR") as mock_dir:
            mock_path = MagicMock()
            mock_path.__truediv__ = MagicMock(return_value=mock_path)
            mock_path.write_bytes = fake_write_bytes
            mock_dir.__truediv__ = MagicMock(return_value=mock_path)

            resp = client.post(
                "/api/v1/restaurants/logo-resize/logo",
                files={"file": ("logo.png", png_data, "image/png")},
            )

    assert resp.status_code == 200
    # The written bytes should be a smaller image (resized)
    if written_data.get("bytes"):
        from PIL import Image
        img = Image.open(io.BytesIO(written_data["bytes"]))
        assert img.width <= 512
        assert img.height <= 512
