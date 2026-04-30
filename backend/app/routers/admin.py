"""
Admin backoffice API — superadmin endpoints.

Endpoints:
  GET  /api/v1/admin/stats          — global KPIs
  GET  /api/v1/admin/restaurants    — list all restaurants (menus)
  PATCH /api/v1/admin/restaurants/{slug}/status — activate/deactivate
  GET  /api/v1/admin/subscriptions  — list all subscriptions
  GET  /api/v1/admin/audit-logs     — paginated audit logs with filters
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import AuditLog, Menu, Order, Payment, Subscription
from app.routers.auth import require_admin

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _menu_to_dict(menu: Menu, subscription: Subscription | None = None) -> dict:
    return {
        "id": menu.id,
        "slug": menu.slug,
        "restaurant_name": menu.restaurant_name,
        "ocr_status": menu.status,          # "processing" | "ready" | "error"
        "publish_status": menu.publish_status,  # "draft" | "published"
        "languages": menu.languages,
        "created_at": menu.created_at.isoformat() if menu.created_at else None,
        "plan": subscription.plan if subscription else "free",
        "sub_status": subscription.status if subscription else None,
        "stripe_subscription_id": (
            subscription.stripe_subscription_id if subscription else None
        ),
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/stats")
def get_admin_stats(db: Session = Depends(get_db), _: dict = Depends(require_admin)):
    """Global platform KPIs."""
    total_restaurants = db.query(func.count(Menu.id)).scalar() or 0
    active_restaurants = (
        db.query(func.count(Menu.id))
        .filter(Menu.status == "active")
        .scalar()
        or 0
    )
    pro_count = (
        db.query(func.count(Subscription.id))
        .filter(Subscription.plan == "pro", Subscription.status == "active")
        .scalar()
        or 0
    )
    # Revenue: sum of succeeded payments in cents → euros
    revenue_cents = (
        db.query(func.sum(Payment.amount))
        .filter(Payment.status == "succeeded")
        .scalar()
        or 0
    )
    total_orders = db.query(func.count(Order.id)).scalar() or 0
    total_conversations = (
        db.query(func.count(AuditLog.id))
        .filter(AuditLog.action == "feedback.nps")
        .scalar()
        or 0
    )

    return {
        "total_restaurants": total_restaurants,
        "active_restaurants": active_restaurants,
        "pro_subscriptions": pro_count,
        "free_subscriptions": total_restaurants - pro_count,
        "total_revenue_eur": round(revenue_cents / 100, 2),
        "total_orders": total_orders,
        "total_nps_responses": total_conversations,
    }


@router.get("/restaurants")
def list_restaurants(
    status: str | None = Query(None, description="Filter by publish status: published|draft"),
    plan: str | None = Query(None, description="Filter by plan: free|pro"),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """List all restaurants with subscription info."""
    query = db.query(Menu)
    if status:
        # Map legacy "active"/"inactive" to publish_status values
        publish_status = {"active": "published", "inactive": "draft"}.get(status, status)
        query = query.filter(Menu.publish_status == publish_status)
    menus = query.order_by(Menu.created_at.desc()).all()

    # Fetch subscriptions keyed by slug (restaurant_id == slug in our data)
    subs = db.query(Subscription).all()
    sub_map: dict[str, Subscription] = {s.restaurant_id: s for s in subs}

    result = []
    for menu in menus:
        sub = sub_map.get(menu.slug)
        if plan and (sub.plan if sub else "free") != plan:
            continue
        result.append(_menu_to_dict(menu, sub))

    return {"restaurants": result, "total": len(result)}


@router.patch("/restaurants/{slug}/status")
def update_restaurant_status(
    slug: str, body: dict, db: Session = Depends(get_db), _: dict = Depends(require_admin)
):
    """Publish or unpublish a restaurant menu (sets Menu.publish_status)."""
    new_status = body.get("status")
    if new_status not in ("active", "inactive", "published", "draft"):
        raise HTTPException(
            status_code=400, detail="status must be 'active'/'published' or 'inactive'/'draft'"
        )
    # Normalise legacy "active"/"inactive" to publish_status values
    publish_status = {"active": "published", "inactive": "draft"}.get(new_status, new_status)

    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Restaurant not found")
    menu.publish_status = publish_status
    db.commit()
    db.refresh(menu)

    # Log the action
    log = AuditLog(
        actor_type="admin",
        actor_id="superadmin",
        action=f"restaurant.{publish_status}",
        resource_type="menu",
        resource_id=slug,
        payload={"slug": slug, "publish_status": publish_status},
    )
    db.add(log)
    db.commit()

    return {"slug": slug, "publish_status": menu.publish_status}


@router.get("/subscriptions")
def list_subscriptions(
    plan: str | None = Query(None),
    status: str | None = Query(None),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """List all subscriptions."""
    query = db.query(Subscription)
    if plan:
        query = query.filter(Subscription.plan == plan)
    if status:
        query = query.filter(Subscription.status == status)
    subs = query.order_by(Subscription.created_at.desc()).all()

    return {
        "subscriptions": [
            {
                "id": s.id,
                "restaurant_id": s.restaurant_id,
                "plan": s.plan,
                "status": s.status,
                "stripe_subscription_id": s.stripe_subscription_id,
                "current_period_end": (
                    s.current_period_end.isoformat()
                    if s.current_period_end
                    else None
                ),
                "created_at": s.created_at.isoformat() if s.created_at else None,
            }
            for s in subs
        ],
        "total": len(subs),
    }


@router.get("/audit-logs")
def list_audit_logs(
    actor_type: str | None = Query(None),
    action: str | None = Query(None),
    resource_type: str | None = Query(None),
    resource_id: str | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    _: dict = Depends(require_admin),
):
    """Paginated audit log viewer with optional filters."""
    query = db.query(AuditLog)

    if actor_type:
        query = query.filter(AuditLog.actor_type == actor_type)
    if action:
        query = query.filter(AuditLog.action.ilike(f"%{action}%"))
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)
    if resource_id:
        query = query.filter(AuditLog.resource_id == resource_id)
    if from_date:
        try:
            dt = datetime.fromisoformat(from_date).replace(tzinfo=timezone.utc)
            query = query.filter(AuditLog.created_at >= dt)
        except ValueError:
            pass
    if to_date:
        try:
            dt = datetime.fromisoformat(to_date).replace(tzinfo=timezone.utc)
            query = query.filter(AuditLog.created_at <= dt)
        except ValueError:
            pass

    total = query.count()
    logs = query.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "logs": [
            {
                "id": log.id,
                "actor_type": log.actor_type,
                "actor_id": log.actor_id,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "payload": log.payload,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }
