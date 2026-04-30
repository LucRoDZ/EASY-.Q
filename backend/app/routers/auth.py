"""Auth router — Clerk JWT /me + Clerk webhook handler.

Endpoints (prefix /api/v1/auth):
  GET  /me          — return current user info from Clerk JWT
  POST /webhook     — handle Clerk user lifecycle webhook events
"""

import hashlib
import hmac
import json
import logging
from base64 import b64decode

import requests as _requests
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from jose import JWTError, jwt as jose_jwt
from sqlalchemy.orm import Session

from app.config import ADMIN_USER_IDS, CLERK_JWKS_URL, CLERK_WEBHOOK_SECRET
from app.db import get_db
from app.models import AuditLog, Subscription

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ---------------------------------------------------------------------------
# JWT helpers (lightweight — Clerk tokens are RS256, we decode without verify
# in this layer; signature verification is done by Clerk middleware or JWKS)
# ---------------------------------------------------------------------------


def _decode_jwt_payload(token: str) -> dict:
    """Decode the JWT payload without signature verification.

    The token format is: header.payload.signature (base64url-encoded).
    We add padding manually as b64decode requires it.
    """
    try:
        parts = token.split(".")
        if len(parts) != 3:
            raise ValueError("Invalid JWT format")
        payload_b64 = parts[1]
        # Add padding
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        # base64url → base64
        payload_b64 = payload_b64.replace("-", "+").replace("_", "/")
        return json.loads(b64decode(payload_b64).decode("utf-8"))
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {e}")


def _extract_bearer(authorization: str | None) -> str:
    """Extract the Bearer token from the Authorization header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    return authorization[len("Bearer "):]


# ---------------------------------------------------------------------------
# JWKS-verified JWT decoding
# ---------------------------------------------------------------------------

_jwks_cache: dict | None = None


def _get_jwks() -> dict:
    """Fetch Clerk JWKS (cached in memory for the process lifetime)."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    if not CLERK_JWKS_URL:
        raise HTTPException(status_code=500, detail="CLERK_JWKS_URL not configured")
    try:
        resp = _requests.get(CLERK_JWKS_URL, timeout=5)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        return _jwks_cache
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch JWKS: {exc}")


def _verify_jwt(token: str) -> dict:
    """Decode and verify a Clerk JWT against the JWKS.

    Falls back to unverified decode when CLERK_JWKS_URL is not set (dev mode).
    """
    if not CLERK_JWKS_URL:
        # Dev mode — decode without signature verification
        return _decode_jwt_payload(token)

    try:
        jwks = _get_jwks()
        # python-jose can resolve the key from the JWKS set automatically
        payload = jose_jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
        return payload
    except JWTError as exc:
        raise HTTPException(status_code=401, detail=f"Invalid token signature: {exc}")


# ---------------------------------------------------------------------------
# Admin guard dependency
# ---------------------------------------------------------------------------


def require_admin(authorization: str | None = Header(None)) -> dict:
    """FastAPI dependency — raises 401/403 unless the caller is a known admin.

    Usage::

        @router.get("/stats")
        def get_stats(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
            ...
    """
    token = _extract_bearer(authorization)
    payload = _verify_jwt(token)

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    if not ADMIN_USER_IDS:
        # No admins configured — deny all access (fail-secure)
        raise HTTPException(
            status_code=403,
            detail="Admin access not configured. Set ADMIN_USER_IDS env var.",
        )

    if user_id not in ADMIN_USER_IDS:
        raise HTTPException(status_code=403, detail="Forbidden: admin access required")

    return payload


# ---------------------------------------------------------------------------
# GET /me
# ---------------------------------------------------------------------------


@router.get("/me")
def get_current_user(
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Return current authenticated user info from the Clerk JWT.

    The JWT payload contains the Clerk user_id (sub), email, and org info.
    We decode the payload without signature verification here — production
    setups should add Clerk JWKS verification middleware.
    """
    token = _extract_bearer(authorization)
    payload = _decode_jwt_payload(token)

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing sub claim")

    email = payload.get("email", "")
    org_id = payload.get("org_id") or payload.get("azp", "")

    # Look up subscription plan for the org
    plan = "free"
    if org_id:
        sub = db.query(Subscription).filter(Subscription.restaurant_id == org_id).first()
        if sub:
            plan = sub.plan

    return {
        "user_id": user_id,
        "email": email,
        "org_id": org_id,
        "plan": plan,
    }


# ---------------------------------------------------------------------------
# POST /webhook — Clerk user lifecycle events
# ---------------------------------------------------------------------------


def _verify_svix_signature(
    payload: bytes,
    svix_id: str,
    svix_timestamp: str,
    svix_signature: str,
    secret: str,
) -> bool:
    """Verify a Svix webhook signature (used by Clerk).

    Signed string: "{svix_id}.{svix_timestamp}.{body}"
    HMAC-SHA256 with the base64url-decoded secret (after stripping "whsec_" prefix).
    """
    if not secret:
        return True  # Dev mode — skip verification

    try:
        raw_secret = secret.removeprefix("whsec_")
        # Add padding for base64 decode
        padding = 4 - len(raw_secret) % 4
        if padding != 4:
            raw_secret += "=" * padding
        key = b64decode(raw_secret.replace("-", "+").replace("_", "/"))
    except Exception:
        return False

    signed_content = f"{svix_id}.{svix_timestamp}.".encode() + payload
    expected = hmac.new(key, signed_content, hashlib.sha256).digest()
    import base64
    expected_b64 = base64.b64encode(expected).decode()

    # svix_signature may contain multiple values separated by space, prefixed with "v1,"
    for sig in svix_signature.split(" "):
        if sig.startswith("v1,") and hmac.compare_digest(sig[3:], expected_b64):
            return True
    return False


@router.post("/webhook")
async def clerk_webhook(
    request: Request,
    svix_id: str | None = Header(None, alias="svix-id"),
    svix_timestamp: str | None = Header(None, alias="svix-timestamp"),
    svix_signature: str | None = Header(None, alias="svix-signature"),
    db: Session = Depends(get_db),
):
    """Handle Clerk webhook events for user lifecycle management.

    Supported events:
    - user.created  → log onboarding event
    - user.updated  → log profile update
    - user.deleted  → log deletion (GDPR)
    """
    payload = await request.body()

    # Verify signature
    if not _verify_svix_signature(
        payload,
        svix_id or "",
        svix_timestamp or "",
        svix_signature or "",
        CLERK_WEBHOOK_SECRET,
    ):
        raise HTTPException(status_code=400, detail="Invalid webhook signature")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    event_type = event.get("type", "")
    data = event.get("data", {})
    user_id = data.get("id", "")

    primary_email = ""
    email_addresses = data.get("email_addresses", [])
    if email_addresses:
        primary_id = data.get("primary_email_address_id")
        for addr in email_addresses:
            if addr.get("id") == primary_id or not primary_email:
                primary_email = addr.get("email_address", "")

    # Log the event in AuditLog for GDPR traceability
    action_map = {
        "user.created": "auth.user_created",
        "user.updated": "auth.user_updated",
        "user.deleted": "auth.user_deleted",
    }
    action = action_map.get(event_type, f"auth.{event_type}")

    log = AuditLog(
        actor_type="system",
        actor_id=user_id,
        action=action,
        resource_type="user",
        resource_id=user_id,
        payload={
            "event_type": event_type,
            "email": primary_email,
            "user_id": user_id,
        },
    )
    try:
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()
        logger.exception("Failed to save Clerk webhook audit log for user %s", user_id)

    logger.info("Clerk webhook: %s for user %s (%s)", event_type, user_id, primary_email)
    return {"received": True, "event": event_type}
