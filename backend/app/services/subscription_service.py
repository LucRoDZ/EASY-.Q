"""Plan limits enforcement (Free vs Pro).

Usage::

    from app.services.subscription_service import check_limit
    check_limit(restaurant_id, "max_menus", db, current_count=menu_count)
    check_limit(restaurant_id, "analytics", db)
"""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Subscription

PLAN_LIMITS: dict[str, dict] = {
    "free": {
        "max_menus": 1,
        "max_tables": 10,
        "analytics": False,
        "translations": False,
        "kds": False,
    },
    "pro": {
        "max_menus": None,   # unlimited
        "max_tables": None,  # unlimited
        "analytics": True,
        "translations": True,
        "kds": True,
    },
}

FEATURE_LABELS = {
    "max_menus": "menu",
    "max_tables": "tables",
    "analytics": "Analytics",
    "translations": "Traductions",
    "kds": "Écran cuisine (KDS)",
}


def get_plan(restaurant_id: str | None, db: Session) -> str:
    """Return the active plan for a restaurant ('free' by default)."""
    if not restaurant_id:
        return "free"
    sub = (
        db.query(Subscription)
        .filter(
            Subscription.restaurant_id == restaurant_id,
            Subscription.status.in_(("active", "trialing")),
        )
        .first()
    )
    return sub.plan if sub else "free"


def check_limit(
    restaurant_id: str | None,
    feature: str,
    db: Session,
    current_count: int | None = None,
) -> None:
    """Raise HTTP 403 when the plan does not allow the feature / exceeds the quota."""
    plan = get_plan(restaurant_id, db)
    limit = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"]).get(feature)
    label = FEATURE_LABELS.get(feature, feature)

    if limit is False:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PRO_REQUIRED",
                "message": f"La fonctionnalité « {label} » nécessite le plan Pro.",
                "upgrade_url": "/upgrade",
            },
        )
    if isinstance(limit, int) and current_count is not None and current_count >= limit:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "PLAN_LIMIT_REACHED",
                "message": f"Plan Free limité à {limit} {label}. Passez en Pro pour aller plus loin.",
                "upgrade_url": "/upgrade",
            },
        )
