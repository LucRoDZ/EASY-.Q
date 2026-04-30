"""Cloudflare R2 async storage client.

Cloudflare R2 is S3-compatible — uses aioboto3 under the hood.

Required env vars:
  R2_BUCKET_NAME         — R2 bucket name (default: "easyq")
  R2_ACCESS_KEY_ID       — R2 API token access key
  R2_SECRET_ACCESS_KEY   — R2 API token secret
  R2_ENDPOINT_URL        — https://<account_id>.r2.cloudflarestorage.com

Optional:
  R2_PUBLIC_URL          — custom public domain (e.g. https://cdn.easy.q) for
                           files in a public bucket (skips presigning)

Usage patterns:
  - Server-side upload   : await upload_file(key, bytes, content_type)
  - Server-side download : await download_file(key) -> bytes
  - Presigned GET        : await get_presigned_url(key) -> str (1 h default)
  - Presigned PUT        : await get_presigned_upload_url(key) -> {url, key}
  - Direct public URL    : public_url(key) -> str | None
  - Delete               : await delete_file(key)

Key naming conventions:
  menus/{restaurant_id}/{menu_id}.pdf
  logos/{restaurant_id}/logo.{ext}
  qrcodes/{restaurant_id}/{table_id}.png
  receipts/{restaurant_id}/{payment_id}.pdf
"""

import logging
from typing import BinaryIO, Union

import aioboto3
from botocore.config import Config

from app.config import (
    R2_ACCESS_KEY_ID,
    R2_BUCKET_NAME,
    R2_ENDPOINT_URL,
    R2_PUBLIC_URL,
    R2_SECRET_ACCESS_KEY,
)

logger = logging.getLogger(__name__)

# Presigned URL expiry defaults
PRESIGNED_GET_EXPIRES = 3_600           # 1 hour — menu PDFs, QR codes
PRESIGNED_UPLOAD_EXPIRES = 900          # 15 minutes — direct browser upload
PRESIGNED_RECEIPT_EXPIRES = 365 * 86_400  # 1 year — email receipts

# Boto config: disable checksum since R2 doesn't support all algorithms
_BOTO_CONFIG = Config(
    signature_version="s3v4",
    retries={"max_attempts": 3, "mode": "standard"},
)

_session: aioboto3.Session | None = None


def _get_session() -> aioboto3.Session:
    global _session
    if _session is None:
        _session = aioboto3.Session(
            aws_access_key_id=R2_ACCESS_KEY_ID,
            aws_secret_access_key=R2_SECRET_ACCESS_KEY,
            region_name="auto",
        )
    return _session


def _client_kwargs() -> dict:
    return {
        "endpoint_url": R2_ENDPOINT_URL or None,
        "config": _BOTO_CONFIG,
    }


async def upload_file(
    key: str,
    data: Union[bytes, BinaryIO],
    content_type: str = "application/octet-stream",
) -> str:
    """Upload bytes or a file-like object to R2. Returns the object key."""
    session = _get_session()
    async with session.client("s3", **_client_kwargs()) as client:
        await client.put_object(
            Bucket=R2_BUCKET_NAME,
            Key=key,
            Body=data,
            ContentType=content_type,
        )
    logger.info("storage: uploaded key=%s content_type=%s", key, content_type)
    return key


async def download_file(key: str) -> bytes:
    """Download a file from R2 and return raw bytes."""
    session = _get_session()
    async with session.client("s3", **_client_kwargs()) as client:
        response = await client.get_object(Bucket=R2_BUCKET_NAME, Key=key)
        async with response["Body"] as stream:
            return await stream.read()


async def delete_file(key: str) -> None:
    """Delete an object from R2."""
    session = _get_session()
    async with session.client("s3", **_client_kwargs()) as client:
        await client.delete_object(Bucket=R2_BUCKET_NAME, Key=key)
    logger.info("storage: deleted key=%s", key)


async def get_presigned_url(
    key: str,
    expires_in: int = PRESIGNED_GET_EXPIRES,
) -> str:
    """Generate a presigned GET URL valid for `expires_in` seconds.

    Use for serving private files (PDFs, receipts) without exposing credentials.
    """
    session = _get_session()
    async with session.client("s3", **_client_kwargs()) as client:
        url: str = await client.generate_presigned_url(
            "get_object",
            Params={"Bucket": R2_BUCKET_NAME, "Key": key},
            ExpiresIn=expires_in,
        )
    return url


async def get_presigned_upload_url(
    key: str,
    content_type: str = "application/octet-stream",
    expires_in: int = PRESIGNED_UPLOAD_EXPIRES,
) -> dict:
    """Generate a presigned PUT URL for direct browser → R2 upload.

    Returns {"url": str, "key": str}.
    The frontend PUTs the file body directly to `url` with the matching
    Content-Type header — no backend proxy needed.
    """
    session = _get_session()
    async with session.client("s3", **_client_kwargs()) as client:
        url: str = await client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": R2_BUCKET_NAME,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
    return {"url": url, "key": key}


def public_url(key: str) -> str | None:
    """Return a public CDN URL if R2_PUBLIC_URL is configured, else None.

    Use only for objects in a public bucket (e.g. menu images, logos).
    Falls back to None so callers can generate a presigned URL instead.
    """
    if not R2_PUBLIC_URL:
        return None
    return f"{R2_PUBLIC_URL.rstrip('/')}/{key}"


def storage_configured() -> bool:
    """Return True if the minimum R2 credentials are set."""
    return bool(R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY and R2_ENDPOINT_URL)
