"""
Tests for backend/app/core/storage.py — uses unittest.mock to avoid real R2 calls.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import app.core.storage as storage


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_mock_client(presigned_url: str = "https://r2.example.com/presigned"):
    """Return a mock async context-manager client."""
    mock_client = AsyncMock()
    mock_client.put_object = AsyncMock(return_value={})
    mock_client.delete_object = AsyncMock(return_value={})
    mock_client.generate_presigned_url = AsyncMock(return_value=presigned_url)

    # Simulate streaming body for get_object
    mock_body = AsyncMock()
    mock_body.__aenter__ = AsyncMock(return_value=mock_body)
    mock_body.__aexit__ = AsyncMock(return_value=False)
    mock_body.read = AsyncMock(return_value=b"file-content")
    mock_client.get_object = AsyncMock(return_value={"Body": mock_body})

    # Make the client itself usable as async context manager
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    return mock_client


def _make_mock_session(mock_client):
    mock_session = MagicMock()
    mock_session.client.return_value = mock_client
    return mock_session


# ---------------------------------------------------------------------------
# upload_file
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_upload_file_returns_key():
    mock_client = _make_mock_client()
    mock_session = _make_mock_session(mock_client)

    with patch.object(storage, "_get_session", return_value=mock_session):
        key = await storage.upload_file("menus/123/menu.pdf", b"%PDF-1.4", "application/pdf")

    assert key == "menus/123/menu.pdf"
    mock_client.put_object.assert_awaited_once_with(
        Bucket=storage.R2_BUCKET_NAME,
        Key="menus/123/menu.pdf",
        Body=b"%PDF-1.4",
        ContentType="application/pdf",
    )


# ---------------------------------------------------------------------------
# download_file
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_download_file_returns_bytes():
    mock_client = _make_mock_client()
    mock_session = _make_mock_session(mock_client)

    with patch.object(storage, "_get_session", return_value=mock_session):
        data = await storage.download_file("logos/456/logo.png")

    assert data == b"file-content"
    mock_client.get_object.assert_awaited_once_with(
        Bucket=storage.R2_BUCKET_NAME,
        Key="logos/456/logo.png",
    )


# ---------------------------------------------------------------------------
# delete_file
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_file_calls_s3():
    mock_client = _make_mock_client()
    mock_session = _make_mock_session(mock_client)

    with patch.object(storage, "_get_session", return_value=mock_session):
        await storage.delete_file("receipts/789/receipt.pdf")

    mock_client.delete_object.assert_awaited_once_with(
        Bucket=storage.R2_BUCKET_NAME,
        Key="receipts/789/receipt.pdf",
    )


# ---------------------------------------------------------------------------
# get_presigned_url
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_presigned_url():
    expected = "https://r2.example.com/signed-get"
    mock_client = _make_mock_client(presigned_url=expected)
    mock_session = _make_mock_session(mock_client)

    with patch.object(storage, "_get_session", return_value=mock_session):
        url = await storage.get_presigned_url("menus/1/menu.pdf", expires_in=60)

    assert url == expected
    mock_client.generate_presigned_url.assert_awaited_once_with(
        "get_object",
        Params={"Bucket": storage.R2_BUCKET_NAME, "Key": "menus/1/menu.pdf"},
        ExpiresIn=60,
    )


# ---------------------------------------------------------------------------
# get_presigned_upload_url
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_get_presigned_upload_url():
    expected = "https://r2.example.com/signed-put"
    mock_client = _make_mock_client(presigned_url=expected)
    mock_session = _make_mock_session(mock_client)

    with patch.object(storage, "_get_session", return_value=mock_session):
        result = await storage.get_presigned_upload_url(
            "logos/abc/logo.png", "image/png", expires_in=300
        )

    assert result == {"url": expected, "key": "logos/abc/logo.png"}
    mock_client.generate_presigned_url.assert_awaited_once_with(
        "put_object",
        Params={
            "Bucket": storage.R2_BUCKET_NAME,
            "Key": "logos/abc/logo.png",
            "ContentType": "image/png",
        },
        ExpiresIn=300,
    )


# ---------------------------------------------------------------------------
# public_url helper
# ---------------------------------------------------------------------------

def test_public_url_with_custom_domain(monkeypatch):
    monkeypatch.setattr(storage, "R2_PUBLIC_URL", "https://cdn.easy.q")
    url = storage.public_url("qrcodes/1/table-3.png")
    assert url == "https://cdn.easy.q/qrcodes/1/table-3.png"


def test_public_url_without_domain(monkeypatch):
    monkeypatch.setattr(storage, "R2_PUBLIC_URL", "")
    assert storage.public_url("qrcodes/1/table-3.png") is None


# ---------------------------------------------------------------------------
# storage_configured helper
# ---------------------------------------------------------------------------

def test_storage_configured_true(monkeypatch):
    monkeypatch.setattr(storage, "R2_ACCESS_KEY_ID", "key")
    monkeypatch.setattr(storage, "R2_SECRET_ACCESS_KEY", "secret")
    monkeypatch.setattr(storage, "R2_ENDPOINT_URL", "https://x.r2.cloudflarestorage.com")
    assert storage.storage_configured() is True


def test_storage_configured_false_when_missing(monkeypatch):
    monkeypatch.setattr(storage, "R2_ACCESS_KEY_ID", "")
    assert storage.storage_configured() is False
