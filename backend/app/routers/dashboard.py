import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.db import get_db
from app.models import AuditLog, Menu, Table
from app.services.conversation_service import (
    list_menu_conversations,
    parse_conversation_messages,
)
from app.services.menu_service import get_menu_by_slug
from app.core import redis as redis_core

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _parse_menu_counts(menu_data_json: str | None) -> tuple[int, int]:
    """Return (section_count, item_count) from raw menu_data JSON string."""
    if not menu_data_json:
        return 0, 0
    try:
        data = json.loads(menu_data_json)
        sections = data.get("sections", [])
        item_count = sum(len(s.get("items", [])) for s in sections)
        return len(sections), item_count
    except Exception:
        return 0, 0


@router.get("/menus")
def get_dashboard_menus(db: Session = Depends(get_db)):
    menus = db.query(Menu).order_by(Menu.created_at.desc()).all()

    # Batch table counts: {slug: count}
    table_counts: dict[str, int] = {}
    rows = (
        db.query(Table.menu_slug, func.count(Table.id))
        .filter(Table.is_active == True)
        .group_by(Table.menu_slug)
        .all()
    )
    for slug, cnt in rows:
        table_counts[slug] = cnt

    response = []
    for menu in menus:
        conversations = list_menu_conversations(db, menu.id)
        total_messages = sum(
            len(parse_conversation_messages(c)) for c in conversations
        )
        section_count, item_count = _parse_menu_counts(menu.menu_data)

        response.append(
            {
                "id": menu.id,
                "slug": menu.slug,
                "restaurant_name": menu.restaurant_name,
                "status": menu.status,
                "languages": menu.languages,
                "created_at": menu.created_at.isoformat() if menu.created_at else None,
                "section_count": section_count,
                "item_count": item_count,
                "table_count": table_counts.get(menu.slug, 0),
                "conversation_count": len(conversations),
                "message_count": total_messages,
            }
        )

    return {"menus": response}


@router.get("/menus/{slug}/conversations")
def get_dashboard_conversations(slug: str, db: Session = Depends(get_db)):
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    conversations = list_menu_conversations(db, menu.id)
    conv_data = []

    for conv in conversations:
        conv_data.append(
            {
                "id": conv.id,
                "session_id": conv.session_id,
                "created_at": conv.created_at.isoformat() if conv.created_at else None,
                "updated_at": conv.updated_at.isoformat() if conv.updated_at else None,
                "messages": parse_conversation_messages(conv),
            }
        )

    return {
        "menu": {
            "id": menu.id,
            "slug": menu.slug,
            "restaurant_name": menu.restaurant_name,
        },
        "conversations": conv_data,
    }


@router.get("/menus/{slug}/waiter-calls")
async def get_waiter_calls(slug: str, db: Session = Depends(get_db)):
    """Return pending waiter calls for a restaurant (dashboard polling)."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    try:
        calls = await redis_core.get_waiter_calls(slug)
    except Exception:
        calls = []
    return {"calls": calls}


@router.patch("/menus/{slug}/waiter-calls/{call_id}/status")
async def update_waiter_call_status(
    slug: str, call_id: str, body: dict, db: Session = Depends(get_db)
):
    """Update waiter call status: pending → acknowledged → resolved."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    new_status = body.get("status")
    if new_status not in ("pending", "acknowledged", "resolved"):
        raise HTTPException(
            status_code=400,
            detail="status must be one of: pending, acknowledged, resolved",
        )

    try:
        updated = await redis_core.update_waiter_call_status(slug, call_id, new_status)
    except Exception:
        updated = None

    if updated is None:
        raise HTTPException(status_code=404, detail="Call not found")

    # If resolved, remove from active hash
    if new_status == "resolved":
        try:
            await redis_core.dismiss_waiter_call(slug, call_id)
        except Exception:
            pass

    return updated


@router.delete("/menus/{slug}/waiter-calls/{call_id}")
async def dismiss_waiter_call(slug: str, call_id: str, db: Session = Depends(get_db)):
    """Dismiss (remove) a waiter call from the active list."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    try:
        await redis_core.dismiss_waiter_call(slug, call_id)
    except Exception:
        pass
    return {"status": "dismissed"}


@router.get("/menus/{slug}/waiter-calls/history")
async def get_waiter_call_history(
    slug: str,
    table_number: str | None = None,
    db: Session = Depends(get_db),
):
    """Return waiter call history for a restaurant (last 200 calls), optionally filtered by table."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    try:
        calls = await redis_core.get_call_history(slug, table_number=table_number)
    except Exception:
        calls = []
    return {"calls": calls}


@router.get("/menus/{slug}/analytics/reviews")
def get_review_analytics(slug: str, db: Session = Depends(get_db)):
    """Return NPS analytics for a restaurant: average, distribution, recent reviews."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    logs = (
        db.query(AuditLog)
        .filter(
            AuditLog.action == "feedback.nps",
            AuditLog.resource_id == slug,
        )
        .order_by(AuditLog.created_at.desc())
        .all()
    )

    if not logs:
        return {
            "total": 0,
            "average_nps": None,
            "nps_score": None,
            "promoters": 0,
            "passives": 0,
            "detractors": 0,
            "recent": [],
        }

    scores = [log.payload.get("nps_score", 0) for log in logs if log.payload]
    total = len(scores)
    promoters = sum(1 for s in scores if s >= 9)
    passives = sum(1 for s in scores if 7 <= s <= 8)
    detractors = sum(1 for s in scores if s <= 6)
    average_nps = round(sum(scores) / total, 1) if total else None
    nps_score = round((promoters - detractors) / total * 100, 1) if total else None

    recent = [
        {
            "nps_score": log.payload.get("nps_score"),
            "comment": log.payload.get("comment"),
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs[:10]
        if log.payload
    ]

    return {
        "total": total,
        "average_nps": average_nps,
        "nps_score": nps_score,
        "promoters": promoters,
        "passives": passives,
        "detractors": detractors,
        "recent": recent,
    }
