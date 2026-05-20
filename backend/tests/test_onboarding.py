"""Tests for POST /api/v1/restaurants/onboarding/complete."""
import pytest
from app.models import RestaurantProfile, AuditLog


def test_onboarding_complete_creates_profile(client, test_db):
    resp = client.post(
        "/api/v1/restaurants/onboarding/complete",
        json={"restaurant_name": "Le Bistro", "tables_created": 3, "menu_uploaded": True},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["slug"] == "le-bistro"

    db = test_db()
    profile = db.query(RestaurantProfile).filter_by(slug="le-bistro").first()
    assert profile is not None
    assert profile.name == "Le Bistro"
    db.close()


def test_onboarding_complete_upserts_existing_profile(client, test_db):
    db = test_db()
    db.add(RestaurantProfile(slug="le-bistro", name="Old Name", owner_email="old@x.com"))
    db.commit()
    db.close()

    resp = client.post(
        "/api/v1/restaurants/onboarding/complete",
        json={"restaurant_name": "Le Bistro New", "slug": "le-bistro"},
    )
    assert resp.status_code == 200
    assert resp.json()["slug"] == "le-bistro"

    db = test_db()
    profile = db.query(RestaurantProfile).filter_by(slug="le-bistro").first()
    assert profile is not None
    assert profile.name == "Le Bistro New"
    assert profile.owner_email == "old@x.com"  # not overwritten
    db.close()


def test_onboarding_complete_slug_uses_provided_slug(client, test_db):
    resp = client.post(
        "/api/v1/restaurants/onboarding/complete",
        json={"restaurant_name": "Any Name", "slug": "custom-slug"},
    )
    assert resp.status_code == 200
    assert resp.json()["slug"] == "custom-slug"

    db = test_db()
    profile = db.query(RestaurantProfile).filter_by(slug="custom-slug").first()
    assert profile is not None
    assert profile.name == "Any Name"
    db.close()


def test_onboarding_complete_records_audit_log(client, test_db):
    resp = client.post(
        "/api/v1/restaurants/onboarding/complete",
        json={"restaurant_name": "Audit Test"},
    )
    assert resp.status_code == 200

    db = test_db()
    log = db.query(AuditLog).filter_by(action="onboarding.complete").first()
    assert log is not None
    assert log.payload["restaurant_name"] == "Audit Test"
    db.close()
