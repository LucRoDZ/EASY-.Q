"""Restaurant profile router.

Routes (prefix /api/v1/restaurants):
  GET    /{slug}        — get or auto-create profile
  PATCH  /{slug}        — update name/address/phone/opening_hours/logo_url/timezone/social_links
  POST   /{slug}/logo   — upload logo image (multipart, resized to ≤512x512/500KB), returns logo_url
"""

import io
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from PIL import Image
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.config import BASE_URL, STORAGE_DIR
from app.core import storage as r2
from app.db import get_db
from app.models import AuditLog, Menu, RestaurantProfile
from app.schemas import LogoUploadResponse, RestaurantProfileResponse, RestaurantProfileUpdate

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


def _to_response(p: RestaurantProfile) -> RestaurantProfileResponse:
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


# ---------------------------------------------------------------------------
# GET /{slug}
# ---------------------------------------------------------------------------

@router.get("/{slug}", response_model=RestaurantProfileResponse)
def get_profile(slug: str, db: Session = Depends(get_db)) -> RestaurantProfileResponse:
    """Return restaurant profile; auto-creates a blank one if it doesn't exist yet."""
    profile = _get_or_create(db, slug)
    return _to_response(profile)


# ---------------------------------------------------------------------------
# PATCH /{slug}
# ---------------------------------------------------------------------------

@router.patch("/{slug}", response_model=RestaurantProfileResponse)
def update_profile(
    slug: str,
    body: RestaurantProfileUpdate,
    db: Session = Depends(get_db),
) -> RestaurantProfileResponse:
    """Partial update of restaurant profile fields."""
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
) -> LogoUploadResponse:
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


@router.post("/onboarding/complete")
def complete_onboarding(
    body: OnboardingCompleteBody,
    db: Session = Depends(get_db),
) -> dict:
    """Record onboarding completion in AuditLog and optionally send welcome email."""
    log = AuditLog(
        actor_type="user",
        actor_id=body.slug or body.restaurant_name,
        action="onboarding.complete",
        resource_type="restaurant",
        resource_id=body.slug or body.restaurant_name,
        payload={
            "restaurant_name": body.restaurant_name,
            "tables_created": body.tables_created,
            "menu_uploaded": body.menu_uploaded,
            "demo": body.demo,
        },
    )
    db.add(log)
    db.commit()

    # Send welcome email if owner_email is provided
    if body.owner_email:
        from app.services.email_service import send_welcome_email
        try:
            send_welcome_email(to=body.owner_email, restaurant_name=body.restaurant_name)
        except Exception:
            pass  # Non-critical — don't fail onboarding if email fails

    return {"ok": True}
