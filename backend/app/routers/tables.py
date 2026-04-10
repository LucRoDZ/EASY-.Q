"""Tables router — CRUD + QR code + PDF export.

Routes (prefix /api/v1/tables):
  POST   /bulk               — create N tables at once
  GET    /                   — list tables for a menu_slug
  GET    /export/qr-pdf      — download printable PDF with all QR codes
  GET    /{table_id}         — get one table
  GET    /{table_id}/qr      — inline QR code PNG
  PATCH  /{table_id}         — update number/label/capacity/is_active
  DELETE /{table_id}         — soft-delete (is_active = False)
"""

import re
import uuid as _uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.config import BASE_URL, STORAGE_DIR
from app.db import get_db
from app.models import RestaurantProfile, Table
from app.schemas import TableCreateBulk, TableResponse, TableUpdateBody
from app.services.pdf_service import generate_qr_pdf
from app.services.qr_service import generate_table_qr_bytes

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$")
_NAMED_COLORS = {
    "black", "white", "red", "green", "blue", "yellow", "orange", "purple",
    "pink", "brown", "gray", "grey", "cyan", "magenta", "transparent",
}


def _validate_color(value: str, default: str) -> str:
    """Return value if it's a valid hex or named color, else return default."""
    if _HEX_RE.match(value) or value.lower() in _NAMED_COLORS:
        return value
    return default


def _fetch_logo_data(menu_slug: str, db: Session) -> bytes | None:
    """Return logo bytes for the restaurant, or None if unavailable.

    Only reads local-storage logos to avoid blocking HTTP calls in sync routes.
    """
    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == menu_slug).first()
    if not profile or not profile.logo_url:
        return None

    local_prefix = f"{BASE_URL}/storage/logos/"
    if profile.logo_url.startswith(local_prefix):
        filename = profile.logo_url[len(local_prefix):]
        logo_path = Path(STORAGE_DIR) / "logos" / filename
        if logo_path.exists():
            return logo_path.read_bytes()

    return None

router = APIRouter(prefix="/api/v1/tables", tags=["tables"])


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _table_to_response(t: Table) -> TableResponse:
    return TableResponse(
        id=t.id,
        menu_slug=t.menu_slug,
        number=t.number,
        label=t.label,
        capacity=t.capacity,
        qr_token=t.qr_token,
        qr_url=f"{BASE_URL}/api/v1/tables/{t.id}/qr",
        is_active=t.is_active,
        status=t.status if t.status else "available",
    )


# ---------------------------------------------------------------------------
# POST /bulk — create N tables
# ---------------------------------------------------------------------------

@router.post("/bulk", response_model=list[TableResponse], status_code=201)
def create_tables_bulk(
    body: TableCreateBulk,
    db: Session = Depends(get_db),
) -> list[TableResponse]:
    """Create `count` tables numbered {prefix} {start_at} … {start_at + count - 1}."""
    if body.count < 1 or body.count > 200:
        raise HTTPException(status_code=400, detail="count must be between 1 and 200")

    created: list[Table] = []
    for i in range(body.count):
        number = str(body.start_at + i)
        table = Table(
            menu_slug=body.menu_slug,
            restaurant_id=body.restaurant_id,
            number=number,
            label=body.zone,
            capacity=4,
            qr_token=str(_uuid.uuid4()),
            is_active=True,
        )
        db.add(table)
        created.append(table)

    db.commit()
    for t in created:
        db.refresh(t)

    return [_table_to_response(t) for t in created]


# ---------------------------------------------------------------------------
# GET / — list tables for a menu
# ---------------------------------------------------------------------------

@router.get("", response_model=list[TableResponse])
def list_tables(
    menu_slug: str = Query(..., description="Menu slug to filter tables"),
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
) -> list[TableResponse]:
    q = db.query(Table).filter(Table.menu_slug == menu_slug)
    if not include_inactive:
        q = q.filter(Table.is_active.is_(True))
    tables = q.order_by(Table.id).all()
    return [_table_to_response(t) for t in tables]


# ---------------------------------------------------------------------------
# GET /export/qr-pdf — download PDF (defined BEFORE /{table_id} to avoid conflict)
# ---------------------------------------------------------------------------

@router.get("/export/qr-pdf")
def export_qr_pdf(
    menu_slug: str = Query(...),
    restaurant_name: str = Query("Restaurant"),
    fill_color: str = Query("black", description="QR module color (hex or named)"),
    back_color: str = Query("white", description="QR background color (hex or named)"),
    logo: bool = Query(False, description="Overlay restaurant logo on QR codes"),
    db: Session = Depends(get_db),
) -> Response:
    """Download a printable A4 PDF with QR codes for all active tables."""
    tables = (
        db.query(Table)
        .filter(Table.menu_slug == menu_slug, Table.is_active.is_(True))
        .order_by(Table.id)
        .all()
    )
    if not tables:
        raise HTTPException(status_code=404, detail="No active tables found for this menu")

    fill = _validate_color(fill_color, "black")
    back = _validate_color(back_color, "white")
    logo_data = _fetch_logo_data(menu_slug, db) if logo else None

    pdf_bytes = generate_qr_pdf(tables, restaurant_name, menu_slug, fill_color=fill, back_color=back, logo_data=logo_data)
    filename = f"qrcodes-{menu_slug}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# GET /{table_id} — get one table
# ---------------------------------------------------------------------------

@router.get("/{table_id}", response_model=TableResponse)
def get_table(table_id: int, db: Session = Depends(get_db)) -> TableResponse:
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    return _table_to_response(table)


# ---------------------------------------------------------------------------
# GET /{table_id}/qr — return QR PNG inline
# ---------------------------------------------------------------------------

@router.get("/{table_id}/qr")
def get_table_qr(
    table_id: int,
    fill_color: str = Query("black", description="QR module color (hex or named)"),
    back_color: str = Query("white", description="QR background color (hex or named)"),
    logo: bool = Query(False, description="Overlay restaurant logo in center"),
    db: Session = Depends(get_db),
) -> Response:
    """Return the QR code as a PNG image (for use as <img src=...>).

    Optional query params:
    - fill_color: foreground color (default "black"), hex or named
    - back_color: background color (default "white"), hex or named
    - logo: if true, overlay the restaurant logo in the center
    """
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    fill = _validate_color(fill_color, "black")
    back = _validate_color(back_color, "white")
    logo_data = _fetch_logo_data(table.menu_slug, db) if logo else None

    png_bytes = generate_table_qr_bytes(
        table.menu_slug,
        table.qr_token,
        fill_color=fill,
        back_color=back,
        logo_data=logo_data,
    )
    return Response(content=png_bytes, media_type="image/png")


# ---------------------------------------------------------------------------
# PATCH /{table_id} — update table fields
# ---------------------------------------------------------------------------

@router.patch("/{table_id}", response_model=TableResponse)
def update_table(
    table_id: int,
    body: TableUpdateBody,
    db: Session = Depends(get_db),
) -> TableResponse:
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    if body.number is not None:
        table.number = body.number
    if body.label is not None:
        table.label = body.label
    if body.capacity is not None:
        table.capacity = body.capacity
    if body.is_active is not None:
        table.is_active = body.is_active
    if body.status is not None:
        if body.status not in ("available", "occupied", "reserved"):
            raise HTTPException(status_code=400, detail="status must be one of: available, occupied, reserved")
        table.status = body.status

    db.commit()
    db.refresh(table)
    return _table_to_response(table)


# ---------------------------------------------------------------------------
# DELETE /{table_id} — soft-delete
# ---------------------------------------------------------------------------

@router.delete("/{table_id}", status_code=204)
def delete_table(table_id: int, db: Session = Depends(get_db)) -> None:
    table = db.query(Table).filter(Table.id == table_id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    table.is_active = False
    db.commit()
