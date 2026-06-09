"""Restaurant profile router.

Routes (prefix /api/v1/restaurants):
  GET    /{slug}        — get or auto-create profile
  PATCH  /{slug}        — update name/address/phone/opening_hours/logo_url/timezone/social_links
  POST   /{slug}/logo   — upload logo image (multipart, resized to ≤512x512/500KB), returns logo_url
"""

import io
import logging
from pathlib import Path
import requests as _requests

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.config import ADMIN_USER_IDS, BASE_URL, GOOGLE_API_KEY, STORAGE_DIR
from app.core import storage as r2
from app.db import get_db
from app.models import AuditLog, Menu, RestaurantProfile
from app.routers.auth import require_authenticated_user
from app.schemas import LogoUploadResponse, RestaurantProfileResponse, RestaurantProfileUpdate

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/restaurants", tags=["restaurants"])

# Local fallback for logos when R2 is not configured
_LOGO_DIR = Path(STORAGE_DIR) / "logos"

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_LOGO_SIZE = 5 * 1024 * 1024  # 5 MB


def _ensure_logo_dir() -> None:
    _LOGO_DIR.mkdir(parents=True, exist_ok=True)


def _get_or_create(db: Session, slug: str) -> RestaurantProfile:
    """Return existing profile or create a blank one seeded from Menu.restaurant_name."""
    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
    if profile:
        return profile

    # Seed name from the matching menu if it exists
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    profile = RestaurantProfile(
        slug=slug,
        name=menu.restaurant_name if menu else slug,
    )
    db.add(profile)
    db.commit()
    db.refresh(profile)
    return profile


_LOGO_MAX_SIDE = 512      # pixels
_LOGO_MAX_BYTES = 500 * 1024  # 500 KB


def _resize_logo(data: bytes, content_type: str) -> bytes:
    """Resize image to fit within 512x512 and re-encode at ≤500 KB."""
    fmt_map = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP", "image/gif": "PNG"}
    out_fmt = fmt_map.get(content_type, "JPEG")

    img = Image.open(io.BytesIO(data)).convert("RGB")

    if img.width > _LOGO_MAX_SIDE or img.height > _LOGO_MAX_SIDE:
        img.thumbnail((_LOGO_MAX_SIDE, _LOGO_MAX_SIDE), Image.LANCZOS)

    # Re-encode, reducing quality until under 500 KB
    quality = 90
    while quality >= 30:
        buf = io.BytesIO()
        img.save(buf, format=out_fmt, quality=quality, optimize=True)
        result = buf.getvalue()
        if len(result) <= _LOGO_MAX_BYTES:
            return result
        quality -= 10

    # Force save at min quality
    buf = io.BytesIO()
    img.save(buf, format=out_fmt, quality=30, optimize=True)
    return buf.getvalue()


def _to_public_response(p: RestaurantProfile) -> RestaurantProfileResponse:
    """Public response — omits stripe_account_id to prevent exposing payment routing."""
    return RestaurantProfileResponse(
        slug=p.slug,
        name=p.name,
        owner_email=p.owner_email,
        logo_url=p.logo_url,
        address=p.address,
        phone=p.phone,
        opening_hours=p.opening_hours,
        timezone=p.timezone,
        social_links=p.social_links,
        google_place_id=p.google_place_id,
    )


def _to_response(p: RestaurantProfile) -> RestaurantProfileResponse:
    """Private response — includes stripe_account_id (authenticated endpoints only)."""
    return RestaurantProfileResponse(
        slug=p.slug,
        name=p.name,
        owner_email=p.owner_email,
        logo_url=p.logo_url,
        address=p.address,
        phone=p.phone,
        opening_hours=p.opening_hours,
        timezone=p.timezone,
        social_links=p.social_links,
        google_place_id=p.google_place_id,
        stripe_account_id=getattr(p, "stripe_account_id", None),
    )


# ---------------------------------------------------------------------------
# GET /{slug}
# ---------------------------------------------------------------------------

@router.get("/{slug}", response_model=RestaurantProfileResponse)
def get_profile(slug: str, db: Session = Depends(get_db)) -> RestaurantProfileResponse:
    """Return restaurant profile. Returns 404 if the restaurant does not exist."""
    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
    if not profile:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    return _to_public_response(profile)


# ---------------------------------------------------------------------------
# PATCH /{slug}
# ---------------------------------------------------------------------------

def _assert_restaurant_owner(slug: str, current_user: dict, db: Session) -> None:
    """Raise 403 unless current_user owns the restaurant (via Menu.restaurant_id) or is a platform admin."""
    user_id = current_user.get("sub") or ""
    if user_id in ADMIN_USER_IDS:
        return
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu or menu.restaurant_id != user_id:
        raise HTTPException(status_code=403, detail="Forbidden: not the restaurant owner")


@router.patch("/{slug}", response_model=RestaurantProfileResponse)
def update_profile(
    slug: str,
    body: RestaurantProfileUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_authenticated_user),
) -> RestaurantProfileResponse:
    """Partial update of restaurant profile fields."""
    _assert_restaurant_owner(slug, current_user, db)
    profile = _get_or_create(db, slug)

    if body.name is not None:
        profile.name = body.name
    if body.owner_email is not None:
        profile.owner_email = body.owner_email
    if body.logo_url is not None:
        profile.logo_url = body.logo_url
    if body.address is not None:
        profile.address = body.address
    if body.phone is not None:
        profile.phone = body.phone
    if body.opening_hours is not None:
        profile.opening_hours = body.opening_hours
    if body.timezone is not None:
        profile.timezone = body.timezone
    if body.social_links is not None:
        profile.social_links = body.social_links
    if "google_place_id" in body.model_fields_set:
        profile.google_place_id = body.google_place_id
    if "stripe_account_id" in body.model_fields_set:
        profile.stripe_account_id = body.stripe_account_id

    db.commit()
    db.refresh(profile)
    return _to_response(profile)


# ---------------------------------------------------------------------------
# POST /{slug}/logo
# ---------------------------------------------------------------------------

@router.post("/{slug}/logo", response_model=LogoUploadResponse)
async def upload_logo(
    slug: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_authenticated_user),
) -> LogoUploadResponse:
    _assert_restaurant_owner(slug, current_user, db)
    """Upload a logo image. Stores on R2 if configured, otherwise local storage."""
    content_type = file.content_type or ""
    if content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type — JPEG, PNG, WebP or GIF required",
        )

    data = await file.read()
    if len(data) > MAX_LOGO_SIZE:
        raise HTTPException(status_code=400, detail="Logo too large — max 5 MB")

    # Resize and compress to ≤512x512, ≤500 KB
    try:
        data = _resize_logo(data, content_type)
    except Exception:
        raise HTTPException(status_code=400, detail="Could not process image — ensure it is a valid image file")

    ext = content_type.split("/")[-1].replace("jpeg", "jpg")
    r2_key = f"logos/{slug}/logo.{ext}"

    if r2.storage_configured():
        await r2.upload_file(r2_key, data, content_type)
        logo_url = r2.public_url(r2_key) or await r2.get_presigned_url(r2_key)
    else:
        # Local fallback
        _ensure_logo_dir()
        local_path = _LOGO_DIR / f"{slug}.{ext}"
        local_path.write_bytes(data)
        logo_url = f"{BASE_URL}/storage/logos/{slug}.{ext}"

    # Persist URL on profile
    profile = _get_or_create(db, slug)
    profile.logo_url = logo_url
    db.commit()

    return LogoUploadResponse(logo_url=logo_url)


# ---------------------------------------------------------------------------
# POST /onboarding/complete
# ---------------------------------------------------------------------------

class OnboardingCompleteBody(BaseModel):
    restaurant_name: str
    slug: str | None = None
    tables_created: int = 0
    menu_uploaded: bool = False
    demo: bool = False
    owner_email: str | None = None


def _slugify(name: str) -> str:
    import re
    slug = name.lower().strip()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    return slug.strip("-") or "restaurant"


@router.post("/onboarding/complete")
def complete_onboarding(
    body: OnboardingCompleteBody,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_authenticated_user),
) -> dict:
    """Upsert RestaurantProfile and record onboarding completion in AuditLog."""
    slug = body.slug or _slugify(body.restaurant_name)
    raw_email = body.owner_email or current_user.get("email", "")
    owner_email = raw_email if "@" in raw_email and "{{" not in raw_email else ""

    # Upsert profile
    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
    if profile:
        profile.name = body.restaurant_name
    else:
        profile = RestaurantProfile(slug=slug, name=body.restaurant_name, owner_email=owner_email)
        db.add(profile)

    log = AuditLog(
        actor_type="user",
        actor_id=slug,
        action="onboarding.complete",
        resource_type="restaurant",
        resource_id=slug,
        payload={
            "restaurant_name": body.restaurant_name,
            "tables_created": body.tables_created,
            "menu_uploaded": body.menu_uploaded,
            "demo": body.demo,
        },
    )
    db.add(log)
    db.commit()

    # Send welcome email if owner_email is available
    if owner_email:
        from app.services.email_service import send_welcome_email
        try:
            send_welcome_email(to=owner_email, restaurant_name=body.restaurant_name)
        except Exception as e:
            logger.warning("Failed to send welcome email to %s: %s", owner_email, e)  # Non-critical

    return {"status": "ok", "slug": slug}


# ---------------------------------------------------------------------------
# GET /{slug}/google-rating
# ---------------------------------------------------------------------------

_GOOGLE_RATING_CACHE: dict = {}  # {place_id: {"rating": float, "total": int, "cached_at": float}}


@router.get("/{slug}/google-rating")
def get_google_rating(slug: str, db: Session = Depends(get_db)) -> dict:
    """Return Google Places rating for the restaurant. Cached for 1 hour.

    Returns {"rating": float, "user_ratings_total": int} or {} if not configured.
    """
    import time

    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
    if not profile or not profile.google_place_id:
        return {}

    place_id = profile.google_place_id
    now = time.time()

    # Evict stale entries to prevent unbounded memory growth
    stale = [k for k, v in _GOOGLE_RATING_CACHE.items() if (now - v["cached_at"]) >= 3600]
    for k in stale:
        _GOOGLE_RATING_CACHE.pop(k, None)

    cached = _GOOGLE_RATING_CACHE.get(place_id)
    if cached and (now - cached["cached_at"]) < 3600:
        return {"rating": cached["rating"], "user_ratings_total": cached["total"], "place_id": place_id}

    if not GOOGLE_API_KEY:
        return {}

    try:
        resp = _requests.get(
            "https://maps.googleapis.com/maps/api/place/details/json",
            params={
                "place_id": place_id,
                "fields": "rating,user_ratings_total",
                "key": GOOGLE_API_KEY,
            },
            timeout=5.0,
        )
        data = resp.json()
        result = data.get("result", {})
        rating = result.get("rating")
        total = result.get("user_ratings_total")
        if rating is None:
            return {}
        _GOOGLE_RATING_CACHE[place_id] = {"rating": rating, "total": total or 0, "cached_at": now}
        return {"rating": rating, "user_ratings_total": total or 0, "place_id": place_id}
    except Exception as exc:
        logger.warning("Google Places rating fetch failed for %s: %s", place_id, exc)
        return {}
