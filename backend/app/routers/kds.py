"""KDS (Kitchen Display System) — WebSocket real-time orders.

Endpoints:
  WS   /api/v1/ws/kds/{slug}?token=<KDS_SECRET_TOKEN>  — kitchen display
  GET  /api/v1/kds/{slug}/orders                        — list active orders
  PATCH /api/v1/kds/{slug}/orders/{order_id}/status     — update order status
"""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.config import KDS_SECRET_TOKEN
from app.db import get_db
from app.models import Order
from app.services.menu_service import get_menu_by_slug

logger = logging.getLogger(__name__)

router = APIRouter(tags=["kds"])

# ---------------------------------------------------------------------------
# KDS Connection Manager
# ---------------------------------------------------------------------------

class KDSConnectionManager:
    """Manages active WebSocket connections per restaurant slug."""

    def __init__(self):
        # slug → list of WebSocket connections
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, slug: str, ws: WebSocket) -> None:
        await ws.accept()
        self.connections.setdefault(slug, []).append(ws)
        logger.info("KDS connected for %s (total=%d)", slug, len(self.connections[slug]))

    def disconnect(self, slug: str, ws: WebSocket) -> None:
        conns = self.connections.get(slug, [])
        if ws in conns:
            conns.remove(ws)
        logger.info("KDS disconnected for %s (remaining=%d)", slug, len(conns))

    async def broadcast(self, slug: str, message: dict) -> None:
        """Broadcast a JSON message to all KDS screens for this restaurant."""
        conns = list(self.connections.get(slug, []))
        dead = []
        for ws in conns:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(slug, ws)

    def connection_count(self, slug: str) -> int:
        return len(self.connections.get(slug, []))


kds_manager = KDSConnectionManager()


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------

def _verify_kds_token(token: str | None) -> bool:
    return bool(token and token == KDS_SECRET_TOKEN)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@router.websocket("/api/v1/ws/kds/{slug}")
async def kds_websocket(slug: str, ws: WebSocket, token: str | None = None):
    """WebSocket endpoint for KDS screens.

    Auth: ?token=<KDS_SECRET_TOKEN> query parameter.
    On connect: sends all active (non-done) orders as initial state.
    On message: expects {type: "status_update", order_id: int, status: str}.
    Broadcasts: {type: "new_order" | "status_update", ...} to all connected screens.
    """
    if not _verify_kds_token(token):
        await ws.close(code=4401, reason="Unauthorized")
        return

    await kds_manager.connect(slug, ws)

    # Send initial orders snapshot (non-done/cancelled)
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        active_orders = (
            db.query(Order)
            .filter(
                Order.menu_slug == slug,
                Order.status.notin_(["done", "cancelled"]),
            )
            .order_by(Order.created_at.asc())
            .limit(100)
            .all()
        )
        snapshot = [_order_to_dict(o) for o in active_orders]
        await ws.send_json({"type": "snapshot", "orders": snapshot})
    except Exception as e:
        logger.warning("KDS snapshot error for %s: %s", slug, e)
    finally:
        db.close()

    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if msg.get("type") == "status_update":
                order_id = msg.get("order_id")
                new_status = msg.get("status")
                if order_id and new_status:
                    db = SessionLocal()
                    try:
                        updated = _update_order_status(db, order_id, new_status)
                        if updated:
                            await kds_manager.broadcast(slug, {
                                "type": "status_update",
                                "order": _order_to_dict(updated),
                            })
                    except Exception as e:
                        logger.warning("KDS status update error: %s", e)
                    finally:
                        db.close()

    except WebSocketDisconnect:
        kds_manager.disconnect(slug, ws)


# ---------------------------------------------------------------------------
# REST endpoints (for initial load & status updates from non-WS clients)
# ---------------------------------------------------------------------------

@router.get("/api/v1/kds/{slug}/orders")
def list_kds_orders(
    slug: str,
    token: str | None = None,
    db: Session = Depends(get_db),
):
    """List active orders for the KDS screen (all non-done orders)."""
    if not _verify_kds_token(token):
        raise HTTPException(status_code=401, detail="Invalid KDS token")

    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    orders = (
        db.query(Order)
        .filter(
            Order.menu_slug == slug,
            Order.status.notin_(["done", "cancelled"]),
        )
        .order_by(Order.created_at.asc())
        .all()
    )
    return {"orders": [_order_to_dict(o) for o in orders]}


@router.patch("/api/v1/kds/{slug}/orders/{order_id}/status")
async def update_kds_order_status(
    slug: str,
    order_id: int,
    body: dict,
    token: str | None = None,
    db: Session = Depends(get_db),
):
    """Update order status from the KDS screen. Broadcasts to all screens."""
    if not _verify_kds_token(token):
        raise HTTPException(status_code=401, detail="Invalid KDS token")

    new_status = body.get("status")
    valid_statuses = {"pending", "confirmed", "in_progress", "ready", "done", "cancelled"}
    if new_status not in valid_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid status. Must be one of: {sorted(valid_statuses)}",
        )

    updated = _update_order_status(db, order_id, new_status)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not found")

    # Broadcast status change to all connected KDS screens
    await kds_manager.broadcast(slug, {
        "type": "status_update",
        "order": _order_to_dict(updated),
    })

    return _order_to_dict(updated)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _order_to_dict(order: Order) -> dict:
    created_at = order.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    elapsed_seconds = int((now - created_at).total_seconds()) if created_at else 0

    return {
        "id": order.id,
        "menu_slug": order.menu_slug,
        "table_token": order.table_token,
        "items": order.items or [],
        "notes": order.notes,
        "total": order.total,
        "status": order.status,
        "created_at": created_at.isoformat() if created_at else None,
        "elapsed_seconds": elapsed_seconds,
        "is_overdue": elapsed_seconds > 900,  # 15 minutes
    }


def _update_order_status(db: Session, order_id: int, new_status: str) -> Order | None:
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        return None
    if order.status in ("done", "cancelled"):
        return order  # Already terminal — silently ignore
    order.status = new_status
    db.commit()
    db.refresh(order)
    return order
