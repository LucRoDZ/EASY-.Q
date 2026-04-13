import asyncio
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.db import get_db
from app.schemas import (
    PublicMenuResponse,
    ChatRequest,
    ChatResponse,
    ConversationResponse,
    WaiterCallRequest,
    FeedbackRequest,
)
from app.models import AuditLog, Order, RestaurantProfile, Table
from app.services.menu_service import (
    get_menu_by_slug,
    get_menu_data,
    get_full_menu_data,
)
from app.services.chat_service import (
    chat_about_menu,
    chat_about_menu_stream,
    chat_about_menu_with_order,
    MODEL,
)
from app.services.conversation_service import (
    get_conversation_messages,
    save_conversation_messages,
    clear_conversation,
)
from app.services.langfuse_service import langfuse_service
from app.services.email_service import send_low_nps_email
from app.core import redis as redis_core


# ── Redis session sync helpers (called from sync endpoints in thread pool) ────

def _redis_get_session(session_id: str) -> list:
    """Load chat messages from Redis (2h TTL). Returns [] on miss or error."""
    try:
        return asyncio.run(redis_core.get_session(session_id)) or []
    except Exception:
        return []


def _redis_save_session(session_id: str, messages: list) -> None:
    """Persist chat messages to Redis (2h TTL). Best-effort — never raises."""
    try:
        asyncio.run(redis_core.set_session(session_id, messages[-20:]))
    except Exception:
        pass

router = APIRouter(prefix="/api/public", tags=["public"])


@router.get("/menus/{slug}", response_model=PublicMenuResponse)
def get_public_menu(slug: str, lang: str = "en", db: Session = Depends(get_db)):
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    data = get_menu_data(menu, lang)
    return PublicMenuResponse(**data)


@router.get("/menus/{slug}/conversation")
def get_conversation(slug: str, session_id: str, db: Session = Depends(get_db)):
    """Get conversation history for a session"""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    messages = get_conversation_messages(db, menu.id, session_id)
    return ConversationResponse(messages=messages)


@router.delete("/menus/{slug}/conversation")
def delete_conversation(slug: str, session_id: str, db: Session = Depends(get_db)):
    """Clear conversation history for a session"""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    clear_conversation(db, menu.id, session_id)
    return {"status": "cleared"}


@router.post("/menus/{slug}/chat", response_model=ChatResponse)
def chat_with_menu(slug: str, request: ChatRequest, db: Session = Depends(get_db)):
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    full_data = get_full_menu_data(menu)

    lang = request.lang or "en"
    translations = full_data.get("translations", {})
    if lang in translations:
        full_data["sections"] = translations[lang].get(
            "sections", full_data.get("sections", [])
        )
        full_data["wines"] = translations[lang].get("wines", full_data.get("wines", []))

    # Load session history from Redis (fast, TTL 2h) and merge with request
    session_messages = request.messages
    if request.session_id:
        redis_messages = _redis_get_session(request.session_id)
        if redis_messages:
            session_messages = redis_messages

    # Use function calling to support place_order
    answer, order_data = chat_about_menu_with_order(full_data, lang, session_messages)
    order_id = None

    # If Gemini called place_order, create the order in DB and notify kitchen
    if order_data and order_data.get("items"):
        table_id = None
        table_token = getattr(request, "table_token", None)
        if table_token:
            table = db.query(Table).filter(Table.qr_token == table_token).first()
            if table:
                table_id = table.id

        items = order_data["items"]
        total_cents = sum(
            round((item.get("price", 0) or 0) * 100 * item.get("quantity", 1))
            for item in items
        )

        order = Order(
            menu_slug=menu.slug,
            table_id=table_id,
            table_token=table_token,
            items=items,
            total=total_cents,
            currency="eur",
            status="pending",
        )
        db.add(order)
        db.commit()
        db.refresh(order)
        order_id = order.id

        # Broadcast new order to Redis pub/sub for KDS
        try:
            asyncio.run(redis_core.publish_order_event(
                menu.slug,
                {
                    "type": "new_order",
                    "order_id": order_id,
                    "table_token": table_token,
                    "items": items,
                    "status": "pending",
                },
            ))
        except Exception:
            pass  # Best-effort — KDS may not be connected

    if request.session_id:
        trace_data = langfuse_service.trace_chat(
            menu_slug=menu.slug,
            restaurant_name=menu.restaurant_name,
            session_id=request.session_id,
            lang=lang,
            messages=session_messages,
            answer=answer,
            model=MODEL,
        )

        assistant_message = {"role": "assistant", "content": answer}
        if trace_data:
            assistant_message["trace"] = trace_data
        if order_id:
            assistant_message["order_id"] = order_id

        messages_to_save = session_messages + [assistant_message]
        # Save to Redis (primary — 2h TTL) and DB (secondary — durable)
        _redis_save_session(request.session_id, messages_to_save)
        save_conversation_messages(db, menu.id, request.session_id, messages_to_save)

    return ChatResponse(answer=answer, order_id=order_id)


@router.post("/menus/{slug}/chat/stream")
def chat_with_menu_stream(
    slug: str, request: ChatRequest, db: Session = Depends(get_db)
):
    """Streaming chat endpoint using Server-Sent Events."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    full_data = get_full_menu_data(menu)

    lang = request.lang or "en"
    translations = full_data.get("translations", {})
    if lang in translations:
        full_data["sections"] = translations[lang].get(
            "sections", full_data.get("sections", [])
        )
        full_data["wines"] = translations[lang].get("wines", full_data.get("wines", []))

    # Load session history from Redis (fast, TTL 2h) and use as conversation context
    session_messages = request.messages
    if request.session_id:
        redis_messages = _redis_get_session(request.session_id)
        if redis_messages:
            session_messages = redis_messages

    collected_response = []

    def generate():
        try:
            for chunk in chat_about_menu_stream(full_data, lang, session_messages):
                collected_response.append(chunk)
                yield f"data: {chunk}\n\n"

            if request.session_id:
                full_answer = "".join(collected_response)
                trace_data = langfuse_service.trace_chat(
                    menu_slug=menu.slug,
                    restaurant_name=menu.restaurant_name,
                    session_id=request.session_id,
                    lang=lang,
                    messages=session_messages,
                    answer=full_answer,
                    model=MODEL,
                )
                assistant_message = {"role": "assistant", "content": full_answer}
                if trace_data:
                    assistant_message["trace"] = trace_data

                messages_to_save = session_messages + [assistant_message]
                # Save to Redis (primary — 2h TTL) and DB (secondary — durable)
                _redis_save_session(request.session_id, messages_to_save)
                save_conversation_messages(
                    db, menu.id, request.session_id, messages_to_save
                )

            yield "data: [DONE]\n\n"
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.post("/menus/{slug}/feedback")
def submit_feedback(slug: str, body: FeedbackRequest, db: Session = Depends(get_db)):
    """Store NPS feedback in AuditLog. Best-effort — never fails the client."""
    if body.nps_score < 1 or body.nps_score > 10:
        raise HTTPException(status_code=400, detail="nps_score must be between 1 and 10")

    log = AuditLog(
        actor_type="client",
        actor_id=None,
        action="feedback.nps",
        resource_type="menu",
        resource_id=slug,
        payload={
            "nps_score": body.nps_score,
            "comment": body.comment,
            "payment_intent_id": body.payment_intent_id,
            "lang": body.lang,
        },
    )
    try:
        db.add(log)
        db.commit()
    except Exception:
        db.rollback()

    # Send low-NPS alert to restaurant owner (detractors: score < 7)
    if body.nps_score < 7:
        try:
            profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
            if profile and profile.owner_email:
                send_low_nps_email(
                    to=profile.owner_email,
                    nps_score=body.nps_score,
                    comment=body.comment or "",
                    slug=slug,
                )
        except Exception:
            pass  # Best-effort — never block the client

    return {"status": "ok"}


@router.post("/menus/{slug}/call-waiter")
async def call_waiter(slug: str, body: WaiterCallRequest, db: Session = Depends(get_db)):
    """Client calls a waiter from the menu page. Stores in Redis + pub/sub."""
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    table = None
    if body.table_token:
        table = (
            db.query(Table)
            .filter(Table.qr_token == body.table_token, Table.menu_slug == slug)
            .first()
        )

    call_id = str(uuid4())
    call = {
        "id": call_id,
        "slug": slug,
        "table_number": table.number if table else "?",
        "table_label": table.label if table else None,
        "message": body.message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    try:
        await redis_core.push_waiter_call(slug, call)
    except Exception:
        pass  # Best-effort: Redis may not be running in dev

    return {"status": "ok", "call_id": call_id}
