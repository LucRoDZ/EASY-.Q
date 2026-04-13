from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Order, Table
from app.schemas import OrderCreate, OrderResponse

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])

ORDER_EDIT_WINDOW_SECONDS = 120  # 2 minutes


def _euros_to_cents(euros: float) -> int:
    return round(euros * 100)


def _seconds_remaining(order: Order) -> int | None:
    """Return seconds left in the 2-minute edit window, or None if already locked."""
    if order.status != "pending" or not order.created_at:
        return None
    created = order.created_at
    if created.tzinfo is None:
        created = created.replace(tzinfo=timezone.utc)
    elapsed = (datetime.now(timezone.utc) - created).total_seconds()
    remaining = int(ORDER_EDIT_WINDOW_SECONDS - elapsed)
    return max(0, remaining) if remaining > 0 else None


def _auto_lock_if_expired(db: Session, order: Order) -> Order:
    """If the order is pending and > 2 minutes old, auto-lock to 'confirmed'.

    _seconds_remaining returns None when the window has expired (or no created_at),
    so we guard on created_at to avoid locking orders with missing timestamps.
    """
    if order.status == "pending" and order.created_at:
        remaining = _seconds_remaining(order)
        if remaining is None:  # window has expired
            order.status = "confirmed"
            db.commit()
            db.refresh(order)
    return order


def _build_response(order: Order) -> OrderResponse:
    return OrderResponse(
        id=order.id,
        menu_slug=order.menu_slug,
        table_token=order.table_token,
        items=order.items,
        total=order.total,
        currency=order.currency,
        status=order.status,
        notes=order.notes,
        created_at=order.created_at.isoformat() if order.created_at else "",
        seconds_remaining=_seconds_remaining(order),
        pickup_number=getattr(order, "pickup_number", None),
    )


class OrderItemEdit(BaseModel):
    name: str
    quantity: int
    price: float = 0.0
    notes: str | None = None


class OrderEditBody(BaseModel):
    items: list[OrderItemEdit] | None = None
    notes: str | None = None


def _next_pickup_number(db: Session, menu_slug: str) -> int:
    """Generate next daily pickup number for takeout orders (resets at midnight)."""
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    max_num = (
        db.query(func.max(Order.pickup_number))
        .filter(
            Order.menu_slug == menu_slug,
            Order.pickup_number.isnot(None),
            Order.created_at >= today_start,
        )
        .scalar()
    )
    return (max_num or 0) + 1


@router.post("", response_model=OrderResponse, status_code=201)
def create_order(body: OrderCreate, db: Session = Depends(get_db)):
    """Create a new order from the client menu.

    If no table_token is provided, this is a Scan & Go (takeout) order —
    a pickup number is generated automatically.
    """
    # Resolve table if token provided
    table_id = None
    if body.table_token:
        table = db.query(Table).filter(Table.qr_token == body.table_token).first()
        if not table:
            raise HTTPException(status_code=404, detail="Table not found")
        table_id = table.id

    # Calculate total in cents
    total_cents = sum(
        _euros_to_cents(item.price * item.quantity) for item in body.items
    )

    # Generate pickup number for takeout (no table)
    pickup_number = None
    if not body.table_token:
        pickup_number = _next_pickup_number(db, body.menu_slug)

    order = Order(
        menu_slug=body.menu_slug,
        table_id=table_id,
        table_token=body.table_token,
        items=[item.model_dump() for item in body.items],
        total=total_cents,
        currency=body.currency.lower(),
        status="pending",
        notes=body.notes,
        pickup_number=pickup_number,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    return _build_response(order)


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(order_id: int, db: Session = Depends(get_db)):
    """Get an order by ID. Auto-locks pending orders past 2 minutes."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    order = _auto_lock_if_expired(db, order)
    return _build_response(order)


@router.patch("/{order_id}", response_model=OrderResponse)
def edit_order(order_id: int, body: OrderEditBody, db: Session = Depends(get_db)):
    """Modify order items/notes within the 2-minute edit window.

    Returns 409 Conflict if the order is no longer in 'pending' status
    (either manually confirmed or the 2-minute window has expired).
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    # Auto-lock if window expired
    order = _auto_lock_if_expired(db, order)

    if order.status != "pending":
        raise HTTPException(
            status_code=409,
            detail="Order is locked — the 2-minute edit window has closed",
        )

    if body.items is not None:
        order.items = [i.model_dump() for i in body.items]
        order.total = sum(_euros_to_cents(i.price * i.quantity) for i in body.items)

    if body.notes is not None:
        order.notes = body.notes

    db.commit()
    db.refresh(order)
    return _build_response(order)


@router.patch("/{order_id}/status", response_model=OrderResponse)
def update_order_status(order_id: int, status: str, db: Session = Depends(get_db)):
    """Update order status (restaurant/KDS use). Only allowed for non-done orders."""
    valid_statuses = {"pending", "confirmed", "in_progress", "ready", "done", "cancelled"}
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {valid_statuses}")

    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.status == "done":
        raise HTTPException(status_code=409, detail="Order is already done and cannot be modified")

    order.status = status
    db.commit()
    db.refresh(order)
    return _build_response(order)


@router.get("/by-table/{table_token}", response_model=list[OrderResponse])
def list_orders_by_table(table_token: str, db: Session = Depends(get_db)):
    """List all orders for a table (used by restaurant dashboard)."""
    orders = (
        db.query(Order)
        .filter(Order.table_token == table_token)
        .order_by(Order.created_at.desc())
        .limit(50)
        .all()
    )
    return [_build_response(o) for o in orders]
