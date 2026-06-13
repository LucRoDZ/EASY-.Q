"""Waiter WebSocket — realtime calls & order events for the waiter screen.

Endpoint:
  WS /api/v1/ws/waiter/{menu_slug}

Auth: first message after connect must be {"token": "<clerk_jwt>"}.
The caller must own the menu or be a waiter assigned to it
(public_metadata.role == "waiter" and public_metadata.menu_slug == slug).

Events sent to the client (published on Redis channel ``waiter:{slug}``):
  {type: "waiter_call", call: {...}}
  {type: "order_ready", order: {...}}
  {type: "new_order", order: {...}}

Events accepted from the client:
  {type: "acknowledge_call", call_id: "..."}
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.models import Menu, WaiterCall

logger = logging.getLogger(__name__)

router = APIRouter(tags=["waiter-ws"])


def _authorize(payload: dict, menu: Menu, slug: str) -> bool:
    if not payload.get("sub"):
        return False
    if menu.restaurant_id == payload["sub"]:
        return True
    meta = payload.get("public_metadata") or {}
    return meta.get("role") == "waiter" and meta.get("menu_slug") == slug


@router.websocket("/api/v1/ws/waiter/{menu_slug}")
async def waiter_websocket(menu_slug: str, ws: WebSocket):
    from app.db import SessionLocal
    from app.routers.auth import _verify_jwt

    await ws.accept()

    # Authenticate via first message (keeps the JWT out of access logs)
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=10.0)
        msg = json.loads(raw)
        token = msg.get("token") if isinstance(msg, dict) else None
    except (asyncio.TimeoutError, json.JSONDecodeError):
        token = None

    payload = None
    if token:
        try:
            payload = _verify_jwt(token)
        except Exception:
            payload = None

    db = SessionLocal()
    try:
        menu = db.query(Menu).filter(Menu.slug == menu_slug).first()
        if not menu or not payload or not _authorize(payload, menu, menu_slug):
            await ws.close(code=4401, reason="Unauthorized")
            return
    finally:
        db.close()

    await ws.send_json({"type": "connected"})

    from app.core import redis as redis_core

    pubsub = None
    try:
        client = redis_core.get_client()
        pubsub = client.pubsub()
        await pubsub.subscribe(redis_core.waiter_channel(menu_slug))
    except Exception as exc:
        logger.warning("Waiter WS: Redis unavailable for %s: %s", menu_slug, exc)
        pubsub = None

    async def forward_events() -> None:
        if pubsub is None:
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
                logger.warning("Waiter WS forward error for %s: %s", menu_slug, exc)

    async def consume_client() -> None:
        while True:
            raw_msg = await ws.receive_text()
            try:
                msg = json.loads(raw_msg)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "acknowledge_call" and msg.get("call_id"):
                await _acknowledge_call(menu_slug, str(msg["call_id"]))

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
                await pubsub.unsubscribe(redis_core.waiter_channel(menu_slug))
                await pubsub.aclose()
            except Exception:
                logger.debug("Waiter WS pubsub close failed for %s", menu_slug)


async def _acknowledge_call(slug: str, call_id: str) -> None:
    """Mark a waiter call acknowledged in Redis + DB (best-effort)."""
    from app.core import redis as redis_core
    from app.db import SessionLocal

    try:
        await redis_core.update_waiter_call_status(slug, call_id, "acknowledged")
    except Exception as exc:
        logger.warning("Waiter WS ack Redis failed for %s/%s: %s", slug, call_id, exc)

    db = SessionLocal()
    try:
        db_call = db.query(WaiterCall).filter(WaiterCall.call_uid == call_id).first()
        if db_call and db_call.status == "pending":
            db_call.status = "acknowledged"
            db.commit()
    except Exception as exc:
        logger.warning("Waiter WS ack DB failed for %s/%s: %s", slug, call_id, exc)
    finally:
        db.close()
