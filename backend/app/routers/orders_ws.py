"""Order tracking WebSocket — client-facing realtime order status.

Endpoint:
  WS /api/v1/ws/order/{order_id}?token=<table_token>

Auth: the token query param must match the order's table_token.
Takeout orders (no table_token) are accessible without a token.

On connect: sends {type: "snapshot", order: {...}}.
Then forwards every event published on the Redis channel ``order:{order_id}``
(status updates pushed by the KDS / orders router / payment webhook).
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models import Order
from app.routers.kds import _order_to_dict, _resolve_table

logger = logging.getLogger(__name__)

router = APIRouter(tags=["orders-ws"])


@router.websocket("/api/v1/ws/order/{order_id}")
async def order_tracking_websocket(order_id: int, ws: WebSocket, token: str | None = None):
    from app.db import SessionLocal

    db = SessionLocal()
    try:
        order = db.query(Order).filter(Order.id == order_id).first()
        if not order:
            await ws.close(code=4404, reason="Order not found")
            return
        if order.table_token and order.table_token != token:
            await ws.close(code=4403, reason="Invalid token")
            return
        snapshot = _order_to_dict(order, _resolve_table(db, order.table_token))
    finally:
        db.close()

    await ws.accept()
    await ws.send_json({"type": "snapshot", "order": snapshot})

    # Subscribe to the per-order Redis channel and forward events
    from app.core import redis as redis_core

    pubsub = None
    try:
        client = redis_core.get_client()
        pubsub = client.pubsub()
        await pubsub.subscribe(redis_core.order_channel(order_id))
    except Exception as exc:
        logger.warning("Order WS: Redis unavailable for order %s: %s", order_id, exc)
        pubsub = None

    async def forward_events() -> None:
        if pubsub is None:
            # No Redis — keep the socket open, the client will poll via REST
            await asyncio.Event().wait()
            return
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            try:
                event = json.loads(message["data"])
                await ws.send_json(event)
            except WebSocketDisconnect:
                return
            except Exception as exc:
                logger.warning("Order WS forward error for order %s: %s", order_id, exc)

    async def consume_client() -> None:
        # Drain incoming frames just to detect disconnects
        while True:
            await ws.receive_text()

    forward_task = asyncio.create_task(forward_events())
    consume_task = asyncio.create_task(consume_client())
    try:
        done, pending = await asyncio.wait(
            {forward_task, consume_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()
    except WebSocketDisconnect:
        pass
    finally:
        forward_task.cancel()
        consume_task.cancel()
        if pubsub is not None:
            try:
                await pubsub.unsubscribe(redis_core.order_channel(order_id))
                await pubsub.aclose()
            except Exception:
                logger.debug("Order WS pubsub close failed for order %s", order_id)
