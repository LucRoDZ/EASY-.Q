"""Tests for backend/app/services/email_service.py

Uses monkeypatching — no live Resend API calls.
"""

import types
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

import app.services.email_service as svc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _fake_send_ok(params):
    """Fake Resend Emails.send that returns a simple response object."""
    resp = types.SimpleNamespace(id="test-email-id-123")
    return resp


@pytest.fixture(autouse=True)
def patch_resend(monkeypatch):
    """Patch resend.Emails.send AND inject a fake API key so _send() doesn't no-op."""
    monkeypatch.setattr(svc, "RESEND_API_KEY", "re_test_key")
    monkeypatch.setattr(svc, "RESEND_FROM_EMAIL", "noreply@test.app")
    # Reset the module-level configured flag so _configure() runs with patched key
    import resend as _resend_mod
    monkeypatch.setattr(_resend_mod, "api_key", "re_test_key")

    mock_send = MagicMock(side_effect=_fake_send_ok)
    monkeypatch.setattr("resend.Emails.send", mock_send)
    return mock_send


# ---------------------------------------------------------------------------
# email_configured()
# ---------------------------------------------------------------------------

def test_email_configured_true(monkeypatch):
    monkeypatch.setattr(svc, "RESEND_API_KEY", "re_somekey")
    assert svc.email_configured() is True


def test_email_configured_false(monkeypatch):
    monkeypatch.setattr(svc, "RESEND_API_KEY", "")
    assert svc.email_configured() is False


# ---------------------------------------------------------------------------
# No-op when not configured
# ---------------------------------------------------------------------------

def test_send_returns_none_when_not_configured(monkeypatch):
    monkeypatch.setattr(svc, "RESEND_API_KEY", "")
    result = svc.send_welcome_email("owner@resto.fr", "Le Bistrot")
    assert result is None


# ---------------------------------------------------------------------------
# send_welcome_email
# ---------------------------------------------------------------------------

def test_send_welcome_email_calls_resend(patch_resend):
    result = svc.send_welcome_email("chef@bistro.fr", "Le Bistrot de la Paix")

    patch_resend.assert_called_once()
    params = patch_resend.call_args[0][0]

    assert params["to"] == ["chef@bistro.fr"]
    assert "Bienvenue" in params["subject"]
    assert "Le Bistrot de la Paix" in params["html"]
    assert result is not None


# ---------------------------------------------------------------------------
# send_new_payment_email
# ---------------------------------------------------------------------------

def test_send_new_payment_email(patch_resend):
    paid_at = datetime(2025, 6, 15, 20, 30)
    svc.send_new_payment_email("owner@bistro.fr", 87.50, "Table 4", paid_at)

    params = patch_resend.call_args[0][0]
    assert params["to"] == ["owner@bistro.fr"]
    assert "87.50" in params["html"]
    assert "Table 4" in params["html"]
    assert "87.50" in params["subject"]


def test_send_new_payment_email_default_time(patch_resend):
    # Should not raise when paid_at is None
    svc.send_new_payment_email("owner@bistro.fr", 12.00, "Table 1")
    assert patch_resend.called


# ---------------------------------------------------------------------------
# send_bad_review_email
# ---------------------------------------------------------------------------

def test_send_bad_review_email_score_and_comment(patch_resend):
    svc.send_bad_review_email(
        "owner@bistro.fr", score=2, comment="Service trop lent", table="Table 7"
    )
    params = patch_resend.call_args[0][0]
    assert "2/5" in params["subject"]
    assert "Service trop lent" in params["html"]
    assert "Table 7" in params["html"]


def test_send_bad_review_email_no_comment(patch_resend):
    svc.send_bad_review_email("owner@bistro.fr", score=1)
    params = patch_resend.call_args[0][0]
    assert "1/5" in params["subject"]


# ---------------------------------------------------------------------------
# send_new_order_email
# ---------------------------------------------------------------------------

def test_send_new_order_email(patch_resend):
    items = [
        {"name": "Entrecôte", "qty": 2},
        {"name": "Crème brûlée", "qty": 1},
    ]
    svc.send_new_order_email("kitchen@bistro.fr", items, "Table 3")

    params = patch_resend.call_args[0][0]
    assert "Table 3" in params["subject"]
    assert "Entrecôte" in params["html"]
    assert "Crème brûlée" in params["html"]


def test_send_new_order_email_empty_items(patch_resend):
    svc.send_new_order_email("kitchen@bistro.fr", [], "Bar")
    assert patch_resend.called


# ---------------------------------------------------------------------------
# send_subscription_renewal_email
# ---------------------------------------------------------------------------

def test_send_subscription_renewal_email(patch_resend):
    svc.send_subscription_renewal_email("owner@bistro.fr", "pro", "15/09/2025")

    params = patch_resend.call_args[0][0]
    assert "PRO" in params["subject"]
    assert "PRO" in params["html"]
    assert "15/09/2025" in params["html"]


# ---------------------------------------------------------------------------
# HTML content sanity checks
# ---------------------------------------------------------------------------

def test_all_emails_contain_base_structure(patch_resend):
    """Each email must include the EASY.Q footer and a DOCTYPE."""
    calls_before = patch_resend.call_count

    svc.send_welcome_email("a@b.com", "Resto A")
    svc.send_new_payment_email("a@b.com", 10.0, "Table 1")
    svc.send_bad_review_email("a@b.com", score=2)
    svc.send_new_order_email("a@b.com", [{"name": "Pizza", "qty": 1}], "Table 2")
    svc.send_subscription_renewal_email("a@b.com", "free", "01/01/2026")

    assert patch_resend.call_count == calls_before + 5

    for call in patch_resend.call_args_list[calls_before:]:
        html = call[0][0]["html"]
        assert "<!DOCTYPE html>" in html
        assert "EASY.Q" in html
