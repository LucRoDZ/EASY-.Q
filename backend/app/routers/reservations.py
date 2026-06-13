"""Reservations router.

Routes (prefix /api/v1/reservations):
  POST  /{slug}        — create a reservation (public, rate-limited)
  GET   /{slug}        — list reservations, optional ?date=YYYY-MM-DD (owner/staff)
  PATCH /{slug}/{id}   — update status: confirmed / cancelled / seated / no_show (owner/staff)
"""

import logging
import re
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Menu, Reservation, RestaurantProfile
from app.routers.auth import require_authenticated_user
from app.routers.public import limiter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/reservations", tags=["reservations"])

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^\d{2}:\d{2}$")
VALID_STATUSES = ("pending", "confirmed", "cancelled", "no_show", "seated")


class ReservationCreate(BaseModel):
    name: str
    phone: str
    email: str | None = None
    party_size: int = 2
    date: str
    time: str
    notes: str | None = None

    @field_validator("name", "phone")
    @classmethod
    def not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Champ requis")
        return v

    @field_validator("date")
    @classmethod
    def valid_date(cls, v: str) -> str:
        if not DATE_RE.match(v):
            raise ValueError("date must be YYYY-MM-DD")
        return v

    @field_validator("time")
    @classmethod
    def valid_time(cls, v: str) -> str:
        if not TIME_RE.match(v):
            raise ValueError("time must be HH:MM")
        return v

    @field_validator("party_size")
    @classmethod
    def valid_party(cls, v: int) -> int:
        if not 1 <= v <= 30:
            raise ValueError("party_size must be between 1 and 30")
        return v


class ReservationUpdate(BaseModel):
    status: str


def _to_dict(r: Reservation) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "phone": r.phone,
        "email": r.email,
        "party_size": r.party_size,
        "date": r.date,
        "time": r.time,
        "status": r.status,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def _assert_owner_or_staff(menu: Menu, user: dict) -> None:
    if menu.restaurant_id == user["sub"]:
        return
    meta = user.get("public_metadata") or {}
    if meta.get("role") == "waiter" and meta.get("menu_slug") == menu.slug:
        return
    raise HTTPException(status_code=403, detail="Access denied")


def _send_confirmation_background(slug: str, reservation_id: int) -> None:
    """Send a confirmation email to the customer. Best-effort."""
    from app.db import SessionLocal
    from app.services.email_service import _send, _wrap, email_configured

    if not email_configured():
        return
    db = SessionLocal()
    try:
        r = db.query(Reservation).filter(Reservation.id == reservation_id).first()
        if not r or not r.email:
            return
        profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
        restaurant_name = profile.name if profile and profile.name else slug
        html = _wrap(
            header_title=restaurant_name,
            header_sub="Demande de réservation reçue",
            body_html=f"""
<p>Bonjour {r.name},</p>
<p>Nous avons bien reçu votre demande de réservation :</p>
<p><span class="badge">{r.date} à {r.time}</span>&nbsp;
   <span class="badge">{r.party_size} personne{'s' if r.party_size > 1 else ''}</span></p>
<p>Le restaurant vous confirmera rapidement. À très bientôt !</p>
""",
        )
        _send(r.email, f"Réservation {r.date} {r.time} — {restaurant_name}", html)
    except Exception as exc:
        logger.warning("Reservation confirmation email failed: %s", exc)
    finally:
        db.close()


@router.post("/{slug}", status_code=201)
@limiter.limit("10/minute")
def create_reservation(
    request: Request,
    slug: str,
    body: ReservationCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Public: create a reservation request for a restaurant."""
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Restaurant not found")

    # Reject reservations in the past
    try:
        when = datetime.strptime(f"{body.date} {body.time}", "%Y-%m-%d %H:%M")
        if when < datetime.now():
            raise HTTPException(status_code=400, detail="La date est déjà passée")
    except ValueError:
        raise HTTPException(status_code=400, detail="Date ou heure invalide")

    reservation = Reservation(
        menu_slug=slug,
        name=body.name,
        phone=body.phone,
        email=(body.email or "").strip() or None,
        party_size=body.party_size,
        date=body.date,
        time=body.time,
        status="pending",
        notes=body.notes,
    )
    db.add(reservation)
    db.commit()
    db.refresh(reservation)

    background_tasks.add_task(_send_confirmation_background, slug, reservation.id)

    return _to_dict(reservation)


@router.get("/{slug}")
def list_reservations(
    slug: str,
    date: str | None = None,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    """Owner/staff: list reservations, optionally filtered by date."""
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    _assert_owner_or_staff(menu, user)

    q = db.query(Reservation).filter(Reservation.menu_slug == slug)
    if date:
        if not DATE_RE.match(date):
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        q = q.filter(Reservation.date == date)
    reservations = q.order_by(Reservation.date.asc(), Reservation.time.asc()).limit(200).all()
    return {"reservations": [_to_dict(r) for r in reservations]}


@router.patch("/{slug}/{reservation_id}")
def update_reservation(
    slug: str,
    reservation_id: int,
    body: ReservationUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    """Owner/staff: confirm / cancel / seat / mark no-show."""
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    _assert_owner_or_staff(menu, user)

    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"status must be one of: {VALID_STATUSES}")

    reservation = (
        db.query(Reservation)
        .filter(Reservation.id == reservation_id, Reservation.menu_slug == slug)
        .first()
    )
    if not reservation:
        raise HTTPException(status_code=404, detail="Reservation not found")

    reservation.status = body.status
    db.commit()
    db.refresh(reservation)
    return _to_dict(reservation)
