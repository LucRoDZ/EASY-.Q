"""KDS (Kitchen Display System) — WebSocket real-time orders.

Endpoints:
  WS   /api/v1/ws/kds/{slug}  — kitchen display (auth: send {"token": "<KDS_SECRET_TOKEN>"} as first message after connect)
  GET  /api/v1/kds/{slug}/orders                        — list active orders
  PATCH /api/v1/kds/{slug}/orders/{order_id}/status     — update order status
"""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from app.config import KDS_SECRET_TOKEN
from app.db import get_db
from app.models import Order, Table
from app.routers.auth import require_owner
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
            except Exception as exc:
                logger.debug("KDS WebSocket send failed (dead connection) for %s: %s", slug, exc)
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
async def kds_websocket(slug: str, ws: WebSocket):
    """WebSocket endpoint for KDS screens.

    Auth: send {"token": "<KDS_SECRET_TOKEN>"} as first message after connect.
    On connect: sends all active (non-done) orders as initial state.
    On message: expects {type: "status_update", order_id: int, status: str}.
    Broadcasts: {type: "new_order" | "status_update", ...} to all connected screens.
    """
    await kds_manager.connect(slug, ws)

    # Authenticate via first WebSocket message (keeps token out of nginx logs)
    try:
        auth_raw = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
        auth_msg = json.loads(auth_raw)
        token = auth_msg.get("token") if isinstance(auth_msg, dict) else None
    except (asyncio.TimeoutError, json.JSONDecodeError):
        token = None

    if not _verify_kds_token(token):
        await ws.close(code=4401, reason="Unauthorized")
        return

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
        tables = _tables_by_token(db, active_orders)
        snapshot = [_order_to_dict(o, tables.get(o.table_token)) for o in active_orders]
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
                            order_dict = _order_to_dict(updated, _resolve_table(db, updated.table_token))
                            await kds_manager.broadcast(slug, {
                                "type": "status_update",
                                "order": order_dict,
                            })
                            await publish_order_tracking_event(order_dict)
                    except Exception as e:
                        logger.warning("KDS status update error: %s", e)
                    finally:
                        db.close()

    except WebSocketDisconnect:
        kds_manager.disconnect(slug, ws)


# ---------------------------------------------------------------------------
# REST endpoints (for initial load & status updates from non-WS clients)
# ---------------------------------------------------------------------------

@router.get("/api/v1/kds/{slug}/token")
def get_kds_token(
    slug: str,
    user: dict = Depends(require_owner),
    db: Session = Depends(get_db),
):
    """Return the KDS secret token for authenticated restaurant owners.
    Used by the dashboard to build the shareable KDS URL."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    if str(menu.restaurant_id) != str(user["sub"]):
        raise HTTPException(status_code=403, detail="Forbidden")
    return {"token": KDS_SECRET_TOKEN}


@router.get("/api/v1/kds/{slug}/orders")
def list_kds_orders(
    slug: str,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """List active orders for the KDS screen (all non-done orders)."""
    token = authorization.removeprefix("Bearer ") if authorization else None
    if not _verify_kds_token(token):
        raise HTTPException(status_code=401, detail="Invalid KDS token")

    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    # KDS is a Pro feature
    from app.services.subscription_service import check_limit
    check_limit(menu.restaurant_id, "kds", db)

    orders = (
        db.query(Order)
        .filter(
            Order.menu_slug == slug,
            Order.status.notin_(["done", "cancelled"]),
        )
        .order_by(Order.created_at.asc())
        .all()
    )
    tables = _tables_by_token(db, orders)
    return {"orders": [_order_to_dict(o, tables.get(o.table_token)) for o in orders]}


@router.patch("/api/v1/kds/{slug}/orders/{order_id}/status")
async def update_kds_order_status(
    slug: str,
    order_id: int,
    body: dict,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Update order status from the KDS screen. Broadcasts to all screens."""
    token = authorization.removeprefix("Bearer ") if authorization else None
    if not _verify_kds_token(token):
        raise HTTPException(status_code=401, detail="Invalid KDS token")

    # KDS is a Pro feature
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    from app.services.subscription_service import check_limit
    check_limit(menu.restaurant_id, "kds", db)

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

    # Broadcast status change to all connected KDS screens + tracking page
    order_dict = _order_to_dict(updated, _resolve_table(db, updated.table_token))
    await kds_manager.broadcast(slug, {
        "type": "status_update",
        "order": order_dict,
    })
    await publish_order_tracking_event(order_dict)

    return order_dict


@router.patch("/api/v1/kds/{slug}/items/availability")
async def set_item_availability(
    slug: str,
    body: dict,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
):
    """Mark a menu item available/unavailable from the KDS (stock outage).

    Body: {"item_name": "Steak haché", "available": false}
    """
    token = authorization.removeprefix("Bearer ") if authorization else None
    if not _verify_kds_token(token):
        raise HTTPException(status_code=401, detail="Invalid KDS token")

    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    item_name = (body.get("item_name") or "").strip()
    available = bool(body.get("available", False))
    if not item_name:
        raise HTTPException(status_code=400, detail="item_name is required")

    unavailable = list(menu.unavailable_items or [])
    if available:
        unavailable = [n for n in unavailable if n != item_name]
    elif item_name not in unavailable:
        unavailable.append(item_name)
    menu.unavailable_items = unavailable  # reassign so SQLAlchemy tracks the JSON change
    db.commit()

    # Invalidate the cached public menu so clients see the change immediately
    try:
        from app.core.redis import invalidate_menu_cache
        await invalidate_menu_cache(slug)
    except Exception as exc:
        logger.warning("Menu cache invalidation failed for %s: %s", slug, exc)

    # Notify connected clients/screens
    await kds_manager.broadcast(slug, {
        "type": "menu_update",
        "item_name": item_name,
        "available": available,
        "unavailable_items": unavailable,
    })

    return {"item_name": item_name, "available": available, "unavailable_items": unavailable}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _order_to_dict(order: Order, table: Table | None = None) -> dict:
    created_at = order.created_at
    if created_at and created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    elapsed_seconds = int((now - created_at).total_seconds()) if created_at else 0

    return {
        "id": order.id,
        "menu_slug": order.menu_slug,
        "table_token": order.table_token,
        "table_number": table.number if table else None,
        "table_label": table.label if table else None,
        "items": order.items or [],
        "notes": order.notes,
        "total": order.total,
        "status": order.status,
        "created_at": created_at.isoformat() if created_at else None,
        "elapsed_seconds": elapsed_seconds,
        "is_overdue": elapsed_seconds > 900,  # 15 minutes
    }


def _resolve_table(db: Session, table_token: str | None) -> Table | None:
    if not table_token:
        return None
    return db.query(Table).filter(Table.qr_token == table_token).first()


def _tables_by_token(db: Session, orders: list[Order]) -> dict[str, Table]:
    """Batch-resolve tables for a list of orders (avoids N+1 in snapshots)."""
    tokens = {o.table_token for o in orders if o.table_token}
    if not tokens:
        return {}
    tables = db.query(Table).filter(Table.qr_token.in_(tokens)).all()
    return {t.qr_token: t for t in tables}


async def publish_order_tracking_event(order_dict: dict) -> None:
    """Best-effort: push a status_update on the per-order tracking channel.

    When the order becomes ready, also notify the waiter screen.
    """
    from app.core.redis import publish_order_status, publish_waiter_event
    try:
        await publish_order_status(order_dict["id"], {"type": "status_update", "order": order_dict})
    except Exception as exc:
        logger.warning("Order tracking publish failed for order %s: %s", order_dict.get("id"), exc)
    if order_dict.get("status") == "ready" and order_dict.get("menu_slug"):
        try:
            await publish_waiter_event(order_dict["menu_slug"], {"type": "order_ready", "order": order_dict})
        except Exception as exc:
            logger.warning("Waiter order_ready publish failed for order %s: %s", order_dict.get("id"), exc)


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


# ---------------------------------------------------------------------------
# Redis pub/sub background subscriber
# ---------------------------------------------------------------------------

async def kds_redis_subscriber() -> None:
    """Long-running task: subscribe to all KDS Redis channels and broadcast to WebSocket clients.

    Listens on pattern ``kds:*`` (one channel per restaurant slug).
    Reconnects automatically on timeout or connection drop.
    """
    from app.core import redis as redis_core

    delay = 1.0
    while True:
        try:
            client = redis_core.get_client()
        except RuntimeError:
            logger.warning("KDS subscriber: Redis not available, retrying in %ss", delay)
            await asyncio.sleep(delay)
            delay = min(delay * 2, 30)
            continue

        pubsub = client.pubsub()
        try:
            await pubsub.psubscribe("kds:*")
            logger.info("KDS Redis subscriber started (pattern kds:*)")
            delay = 1.0  # reset backoff on successful connect
            while True:
                # get_message uses asyncio.wait_for internally — immune to socket-level timeouts
                message = await pubsub.get_message(
                    ignore_subscribe_messages=True, timeout=30.0
                )
                if message is None:
                    continue  # normal — no KDS message in 30s, loop again
                try:
                    channel: str = message.get("channel", "")
                    slug = channel.split(":", 1)[1] if ":" in channel else channel
                    event = json.loads(message["data"])
                    await kds_manager.broadcast(slug, event)
                except Exception as exc:
                    logger.warning("KDS subscriber message error: %s", exc)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.warning("KDS subscriber reconnecting after error: %s", exc)
        finally:
            try:
                await pubsub.punsubscribe("kds:*")
                await pubsub.aclose()
            except Exception:
                pass

        await asyncio.sleep(delay)
        delay = min(delay * 2, 30)
