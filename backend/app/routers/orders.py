from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Order, Table
from app.schemas import OrderCreate, OrderResponse

router = APIRouter(prefix="/api/v1/orders", tags=["orders"])


def _euros_to_cents(euros: float) -> int:
    return round(euros * 100)


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
    )


@router.post("", response_model=OrderResponse, status_code=201)
def create_order(body: OrderCreate, db: Session = Depends(get_db)):
    """Create a new order from the client menu."""

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

    order = Order(
        menu_slug=body.menu_slug,
        table_id=table_id,
        table_token=body.table_token,
        items=[item.model_dump() for item in body.items],
        total=total_cents,
        currency=body.currency.lower(),
        status="pending",
        notes=body.notes,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    return _build_response(order)


@router.get("/{order_id}", response_model=OrderResponse)
def get_order(order_id: int, db: Session = Depends(get_db)):
    """Get an order by ID."""
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return _build_response(order)


@router.patch("/{order_id}/status", response_model=OrderResponse)
def update_order_status(order_id: int, status: str, db: Session = Depends(get_db)):
    """Update order status (restaurant use). Only allowed for non-done orders."""
    valid_statuses = {"pending", "confirmed", "ready", "done", "cancelled"}
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
