"""Staff management router — invite waiters, manage roles & PIN login.

Routes (prefix /api/v1/staff):
  GET    /{slug}             — list staff members (owner)
  POST   /{slug}/invite      — create a StaffMember + Clerk invitation (owner)
  PATCH  /{slug}/{staff_id}  — update role / PIN / active flag (owner)
  DELETE /{slug}/{staff_id}  — deactivate (soft delete, owner)
  POST   /{slug}/pin-login   — verify a 4-digit PIN, return a short tablet session
"""

import logging
import re
import secrets

import bcrypt
import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.config import CLERK_SECRET_KEY, FRONTEND_URL
from app.db import get_db
from app.models import Menu, StaffMember
from app.routers.auth import require_authenticated_user

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/staff", tags=["staff"])

PIN_RE = re.compile(r"^\d{4}$")
VALID_ROLES = ("waiter", "kitchen", "manager")
PIN_SESSION_TTL = 12 * 60 * 60  # 12 hours


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class StaffInviteBody(BaseModel):
    name: str
    email: str
    role: str = "waiter"
    pin: str | None = None

    @field_validator("email")
    @classmethod
    def validate_email(cls, v: str) -> str:
        v = v.strip().lower()
        if not EMAIL_RE.match(v):
            raise ValueError("Adresse email invalide")
        return v


class StaffUpdateBody(BaseModel):
    name: str | None = None
    role: str | None = None
    pin: str | None = None
    is_active: bool | None = None


class PinLoginBody(BaseModel):
    pin: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_owned_menu(slug: str, user: dict, db: Session) -> Menu:
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    if menu.restaurant_id != user["sub"]:
        raise HTTPException(status_code=403, detail="Access denied")
    return menu


def _hash_pin(pin: str) -> str:
    if not PIN_RE.match(pin):
        raise HTTPException(status_code=400, detail="Le PIN doit contenir exactement 4 chiffres")
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def _staff_to_dict(s: StaffMember) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "email": s.email,
        "role": s.role,
        "is_active": s.is_active,
        "has_pin": bool(s.pin_code),
        "clerk_user_id": s.clerk_user_id,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }


def _send_clerk_invitation(email: str, slug: str, role: str) -> bool:
    """Send a Clerk invitation via the backend API. Best-effort."""
    if not CLERK_SECRET_KEY:
        return False
    try:
        resp = httpx.post(
            "https://api.clerk.com/v1/invitations",
            headers={"Authorization": f"Bearer {CLERK_SECRET_KEY}"},
            json={
                "email_address": email,
                "redirect_url": f"{FRONTEND_URL}/waiter",
                "public_metadata": {"role": role, "menu_slug": slug},
            },
            timeout=10,
        )
        resp.raise_for_status()
        return True
    except Exception as exc:
        logger.warning("Clerk invitation failed for %s: %s", email, exc)
        return False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{slug}")
def list_staff(
    slug: str,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    _get_owned_menu(slug, user, db)
    members = (
        db.query(StaffMember)
        .filter(StaffMember.menu_slug == slug)
        .order_by(StaffMember.created_at.asc())
        .all()
    )
    return {"staff": [_staff_to_dict(m) for m in members]}


@router.post("/{slug}/invite", status_code=201)
def invite_staff(
    slug: str,
    body: StaffInviteBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    _get_owned_menu(slug, user, db)
    if body.role not in VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"role must be one of: {VALID_ROLES}")

    existing = (
        db.query(StaffMember)
        .filter(StaffMember.menu_slug == slug, StaffMember.email == body.email)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ce membre est déjà invité")

    member = StaffMember(
        restaurant_id=user["sub"],
        menu_slug=slug,
        name=body.name.strip(),
        email=body.email,
        role=body.role,
        pin_code=_hash_pin(body.pin) if body.pin else None,
        is_active=True,
    )
    db.add(member)
    db.commit()
    db.refresh(member)

    invitation_sent = _send_clerk_invitation(body.email, slug, body.role)

    return {**_staff_to_dict(member), "invitation_sent": invitation_sent}


@router.patch("/{slug}/{staff_id}")
def update_staff(
    slug: str,
    staff_id: int,
    body: StaffUpdateBody,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    _get_owned_menu(slug, user, db)
    member = (
        db.query(StaffMember)
        .filter(StaffMember.id == staff_id, StaffMember.menu_slug == slug)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")

    if body.name is not None:
        member.name = body.name.strip()
    if body.role is not None:
        if body.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail=f"role must be one of: {VALID_ROLES}")
        member.role = body.role
    if body.pin is not None:
        member.pin_code = _hash_pin(body.pin) if body.pin else None
    if body.is_active is not None:
        member.is_active = body.is_active

    db.commit()
    db.refresh(member)
    return _staff_to_dict(member)


@router.delete("/{slug}/{staff_id}", status_code=204)
def deactivate_staff(
    slug: str,
    staff_id: int,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    _get_owned_menu(slug, user, db)
    member = (
        db.query(StaffMember)
        .filter(StaffMember.id == staff_id, StaffMember.menu_slug == slug)
        .first()
    )
    if not member:
        raise HTTPException(status_code=404, detail="Staff member not found")
    member.is_active = False
    db.commit()


@router.post("/{slug}/pin-login")
async def pin_login(
    slug: str,
    body: PinLoginBody,
    db: Session = Depends(get_db),
):
    """Tablet PIN login — returns a short-lived session token (Redis, 12h TTL)."""
    if not PIN_RE.match(body.pin):
        raise HTTPException(status_code=400, detail="PIN invalide")

    members = (
        db.query(StaffMember)
        .filter(
            StaffMember.menu_slug == slug,
            StaffMember.is_active,
            StaffMember.pin_code.isnot(None),
        )
        .all()
    )
    matched = None
    for m in members:
        try:
            if bcrypt.checkpw(body.pin.encode(), m.pin_code.encode()):
                matched = m
                break
        except ValueError:
            continue

    if not matched:
        raise HTTPException(status_code=401, detail="PIN incorrect")

    session_token = secrets.token_urlsafe(32)
    try:
        from app.core import redis as redis_core
        await redis_core.cache_set(
            f"staff_session:{session_token}",
            {"staff_id": matched.id, "menu_slug": slug, "role": matched.role},
            PIN_SESSION_TTL,
        )
    except Exception as exc:
        logger.warning("Staff PIN session store failed: %s", exc)

    return {
        "session_token": session_token,
        "staff": _staff_to_dict(matched),
        "expires_in": PIN_SESSION_TTL,
    }
