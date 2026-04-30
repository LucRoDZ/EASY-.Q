"""Analytics router — revenue, covers, chatbot usage, top items.

Routes (prefix /api/v1/analytics):
  GET /summary?slug=&period=7d|30d|custom&from=&to=  — combined summary
  GET /revenue?slug=&period=7d|30d|custom            — daily revenue breakdown
  GET /covers?slug=&period=7d|30d|custom             — daily covers (orders)
  GET /chatbot?slug=&period=7d|30d|custom            — chatbot sessions + messages
  GET /items?slug=&period=7d|30d|custom              — top items sold
"""

import csv
import io
from datetime import datetime, timedelta, timezone
from collections import defaultdict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Conversation, Payment
from app.services.menu_service import get_menu_by_slug
from app.routers.subscriptions import require_pro

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _parse_period(period: str, from_date: str | None, to_date: str | None):
    """Return (start, end) as UTC datetime objects."""
    now = datetime.now(timezone.utc)
    if period == "custom" and from_date and to_date:
        try:
            start = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
            end = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc)
            return start, end
        except ValueError:
            pass
    days = 30 if period == "30d" else 7
    start = now - timedelta(days=days)
    return start, now


def _prev_period(start: datetime, end: datetime):
    """Return the equally-sized preceding period."""
    delta = end - start
    return start - delta, start


def _date_key(dt: datetime | None, tz=timezone.utc) -> str:
    """Format a datetime to YYYY-MM-DD string."""
    if not dt:
        return ""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    return dt.strftime("%Y-%m-%d")


def _build_date_series(start: datetime, end: datetime) -> list[str]:
    """Return list of YYYY-MM-DD strings from start to end (inclusive)."""
    dates = []
    current = start.replace(hour=0, minute=0, second=0, microsecond=0)
    end_day = end.replace(hour=23, minute=59, second=59)
    while current <= end_day:
        dates.append(current.strftime("%Y-%m-%d"))
        current += timedelta(days=1)
    return dates


# ---------------------------------------------------------------------------
# GET /summary
# ---------------------------------------------------------------------------

@router.get("/summary")
def get_analytics_summary(
    slug: str,
    period: str = "7d",
    from_date: str | None = None,
    to_date: str | None = None,
    restaurant_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Combined analytics summary for the restaurant dashboard. Requires Pro plan."""
    if restaurant_id:
        require_pro(restaurant_id, db)
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    start, end = _parse_period(period, from_date, to_date)
    prev_start, prev_end = _prev_period(start, end)

    # Revenue from succeeded payments
    payments = (
        db.query(Payment)
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= start,
            Payment.created_at <= end,
        )
        .all()
    )
    revenue = sum(p.amount for p in payments) / 100  # to euros

    prev_revenue_q = (
        db.query(func.sum(Payment.amount))
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= prev_start,
            Payment.created_at <= prev_end,
        )
        .scalar()
    )
    prev_revenue = (prev_revenue_q or 0) / 100
    revenue_delta_pct = (
        round((revenue - prev_revenue) / prev_revenue * 100, 1)
        if prev_revenue > 0
        else None
    )

    # Covers = unique table sessions (distinct table_token for succeeded payments)
    covers_q = (
        db.query(func.count(func.distinct(Payment.table_token)))
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= start,
            Payment.created_at <= end,
        )
        .scalar()
    )
    covers = covers_q or 0

    # Average basket
    avg_basket = round(revenue / covers, 2) if covers > 0 else 0.0

    # Tips total
    tips_total = sum(p.tip_amount for p in payments) / 100

    # Top items (from payments items JSON)
    item_counts: dict[str, dict] = {}
    for payment in payments:
        for item in (payment.items or []):
            name = item.get("name", "?")
            qty = item.get("quantity", 1)
            price = item.get("price", 0)
            if name not in item_counts:
                item_counts[name] = {"name": name, "count": 0, "revenue": 0.0}
            item_counts[name]["count"] += qty
            item_counts[name]["revenue"] += price * qty
    top_items = sorted(item_counts.values(), key=lambda x: x["count"], reverse=True)[:10]
    for item in top_items:
        item["revenue"] = round(item["revenue"], 2)

    # Hourly heatmap (hour 0-23 → count of payments)
    hourly: dict[int, int] = defaultdict(int)
    for p in payments:
        if p.created_at:
            h = p.created_at.hour
            hourly[h] += 1
    hourly_heatmap = {str(h): hourly.get(h, 0) for h in range(24)}

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "revenue": round(revenue, 2),
        "revenue_delta_pct": revenue_delta_pct,
        "covers": covers,
        "avg_basket": avg_basket,
        "tips_total": round(tips_total, 2),
        "top_items": top_items,
        "hourly_heatmap": hourly_heatmap,
    }


# ---------------------------------------------------------------------------
# GET /revenue
# ---------------------------------------------------------------------------

@router.get("/revenue")
def get_revenue_analytics(
    slug: str,
    period: str = "7d",
    from_date: str | None = None,
    to_date: str | None = None,
    restaurant_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Daily revenue breakdown. Requires Pro plan."""
    if restaurant_id:
        require_pro(restaurant_id, db)
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    start, end = _parse_period(period, from_date, to_date)

    payments = (
        db.query(Payment)
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= start,
            Payment.created_at <= end,
        )
        .all()
    )

    daily: dict[str, dict] = {
        d: {"date": d, "revenue": 0.0, "transactions": 0}
        for d in _build_date_series(start, end)
    }
    for p in payments:
        key = _date_key(p.created_at)
        if key in daily:
            daily[key]["revenue"] += p.amount / 100
            daily[key]["transactions"] += 1
    for d in daily.values():
        d["revenue"] = round(d["revenue"], 2)

    return {"daily": list(daily.values())}


# ---------------------------------------------------------------------------
# GET /covers
# ---------------------------------------------------------------------------

@router.get("/covers")
def get_covers_analytics(
    slug: str,
    period: str = "7d",
    from_date: str | None = None,
    to_date: str | None = None,
    restaurant_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Daily covers (unique table sessions). Requires Pro plan."""
    if restaurant_id:
        require_pro(restaurant_id, db)
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    start, end = _parse_period(period, from_date, to_date)

    payments = (
        db.query(Payment)
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= start,
            Payment.created_at <= end,
        )
        .all()
    )

    # Count unique table_token per day as "covers"
    daily: dict[str, dict] = {
        d: {"date": d, "covers": 0, "table_tokens": set()}
        for d in _build_date_series(start, end)
    }
    for p in payments:
        key = _date_key(p.created_at)
        if key in daily:
            if p.table_token:
                daily[key]["table_tokens"].add(p.table_token)
            else:
                daily[key]["covers"] += 1  # takeout = 1 cover each

    result = [
        {"date": d, "covers": data["covers"] + len(data["table_tokens"])}
        for d, data in daily.items()
    ]
    return {"daily": result}


# ---------------------------------------------------------------------------
# GET /chatbot
# ---------------------------------------------------------------------------

@router.get("/chatbot")
def get_chatbot_analytics(
    slug: str,
    period: str = "7d",
    from_date: str | None = None,
    to_date: str | None = None,
    restaurant_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Chatbot session and message metrics. Requires Pro plan."""
    if restaurant_id:
        require_pro(restaurant_id, db)
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    start, end = _parse_period(period, from_date, to_date)

    conversations = (
        db.query(Conversation)
        .filter(
            Conversation.menu_id == menu.id,
            Conversation.created_at >= start,
            Conversation.created_at <= end,
        )
        .all()
    )

    total_sessions = len(conversations)
    total_messages = 0
    for conv in conversations:
        try:
            import json
            msgs = json.loads(conv.messages or "[]") if isinstance(conv.messages, str) else (conv.messages or [])
            total_messages += len(msgs)
        except Exception:
            pass

    avg_messages = round(total_messages / total_sessions, 1) if total_sessions else 0

    # Daily sessions
    daily: dict[str, int] = {d: 0 for d in _build_date_series(start, end)}
    for conv in conversations:
        key = _date_key(conv.created_at)
        if key in daily:
            daily[key] += 1

    return {
        "total_sessions": total_sessions,
        "total_messages": total_messages,
        "avg_messages_per_session": avg_messages,
        "daily_sessions": [{"date": d, "sessions": v} for d, v in daily.items()],
    }


# ---------------------------------------------------------------------------
# GET /items
# ---------------------------------------------------------------------------

@router.get("/items")
def get_items_analytics(
    slug: str,
    period: str = "7d",
    from_date: str | None = None,
    to_date: str | None = None,
    restaurant_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Top items sold by quantity and revenue. Requires Pro plan."""
    if restaurant_id:
        require_pro(restaurant_id, db)
    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    start, end = _parse_period(period, from_date, to_date)

    payments = (
        db.query(Payment)
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= start,
            Payment.created_at <= end,
        )
        .all()
    )

    item_stats: dict[str, dict] = {}
    for payment in payments:
        for item in (payment.items or []):
            name = item.get("name", "?")
            qty = item.get("quantity", 1)
            price = item.get("price", 0)
            if name not in item_stats:
                item_stats[name] = {"name": name, "quantity": 0, "revenue": 0.0}
            item_stats[name]["quantity"] += qty
            item_stats[name]["revenue"] += price * qty

    top = sorted(item_stats.values(), key=lambda x: x["quantity"], reverse=True)
    for item in top:
        item["revenue"] = round(item["revenue"], 2)

    return {"items": top}


# ---------------------------------------------------------------------------
# GET /export
# ---------------------------------------------------------------------------

@router.get("/export")
def export_analytics_csv(
    slug: str,
    from_date: str,
    to_date: str,
    format: str = "csv",
    restaurant_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Export payment transactions as CSV for accounting (Sage/QuickBooks/EBP compatible).

    Columns: date, heure, table, montant_ht, tva_10pct, total_ttc, pourboire, stripe_payment_id
    Encoding: UTF-8 BOM, semicolon separator.
    """
    if format != "csv":
        raise HTTPException(status_code=400, detail="Only format=csv is supported")

    if restaurant_id:
        require_pro(restaurant_id, db)

    menu = get_menu_by_slug(db, slug)
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    try:
        start = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
        end = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc).replace(
            hour=23, minute=59, second=59
        )
    except ValueError:
        raise HTTPException(status_code=400, detail="from and to must be ISO dates (YYYY-MM-DD)")

    payments = (
        db.query(Payment)
        .filter(
            Payment.menu_slug == slug,
            Payment.status == "succeeded",
            Payment.created_at >= start,
            Payment.created_at <= end,
        )
        .order_by(Payment.created_at)
        .all()
    )

    output = io.StringIO()
    # UTF-8 BOM for Excel compatibility
    output.write("\ufeff")

    writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_MINIMAL)
    writer.writerow([
        "date", "heure", "table", "articles",
        "montant_ht", "tva_10pct", "total_ttc", "pourboire", "stripe_payment_id",
    ])

    for p in payments:
        dt = p.created_at or datetime.now(timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        date_str = dt.strftime("%d/%m/%Y")
        time_str = dt.strftime("%H:%M")
        table = p.table_token[:8] if p.table_token else "emporter"
        total_ttc = round(p.amount / 100, 2)
        tip = round((p.tip_amount or 0) / 100, 2)
        subtotal = total_ttc - tip
        # TVA 10% sur la restauration : HT = TTC / 1.10
        montant_ht = round(subtotal / 1.10, 2)
        tva = round(subtotal - montant_ht, 2)
        items_str = "; ".join(
            f"{i.get('quantity', 1)}x {i.get('name', '?')}"
            for i in (p.items or [])
        )
        writer.writerow([
            date_str, time_str, table, items_str,
            f"{montant_ht:.2f}", f"{tva:.2f}", f"{total_ttc:.2f}",
            f"{tip:.2f}", p.payment_intent_id or "",
        ])

    csv_bytes = output.getvalue().encode("utf-8-sig")
    filename = f"transactions-{slug}-{from_date}-{to_date}.csv"
    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
