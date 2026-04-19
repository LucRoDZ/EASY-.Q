"""
Subscription management — Stripe Billing integration.

Endpoints:
  POST /api/v1/subscriptions/create-checkout  — create Stripe Checkout Session (Pro plan)
  POST /api/v1/subscriptions/webhook          — handle Stripe billing webhooks
  GET  /api/v1/subscriptions/portal          — create Stripe Customer Portal session
  GET  /api/v1/subscriptions/{restaurant_id} — get current subscription
"""

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import (
    FRONTEND_URL,
    STRIPE_BILLING_WEBHOOK_SECRET,
    STRIPE_PRO_PRICE_ID,
    STRIPE_SECRET_KEY,
)
from app.db import get_db
from app.models import AuditLog, Subscription

stripe.api_key = STRIPE_SECRET_KEY

router = APIRouter(prefix="/api/v1/subscriptions", tags=["subscriptions"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def require_pro(restaurant_id: str, db: Session) -> None:
    """Raise HTTP 402 only when a subscription explicitly exists on a non-Pro plan.

    If no subscription record exists yet (e.g. new account, dev/test environment),
    the request is allowed through — enforcement kicks in once billing is set up.
    """
    sub = db.query(Subscription).filter(
        Subscription.restaurant_id == restaurant_id
    ).first()
    if sub is None:
        return  # No subscription yet → allow (trial / dev / test)
    if sub.plan != "pro" or sub.status not in ("active", "trialing"):
        raise HTTPException(
            status_code=402,
            detail={
                "code": "PRO_REQUIRED",
                "message": "Analytics and payment processing require a Pro plan.",
                "upgrade_url": "/upgrade",
            },
        )


def _get_or_create_subscription(db: Session, restaurant_id: str) -> Subscription:
    sub = db.query(Subscription).filter(
        Subscription.restaurant_id == restaurant_id
    ).first()
    if not sub:
        sub = Subscription(restaurant_id=restaurant_id, plan="free", status="active")
        db.add(sub)
        db.commit()
        db.refresh(sub)
    return sub


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class CheckoutRequest(BaseModel):
    restaurant_id: str
    customer_email: str | None = None


class PortalRequest(BaseModel):
    restaurant_id: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/{restaurant_id}")
def get_subscription(restaurant_id: str, db: Session = Depends(get_db)):
    """Return the current subscription for a restaurant."""
    sub = _get_or_create_subscription(db, restaurant_id)
    return {
        "restaurant_id": sub.restaurant_id,
        "plan": sub.plan,
        "status": sub.status,
        "stripe_subscription_id": sub.stripe_subscription_id,
        "current_period_end": (
            sub.current_period_end.isoformat() if sub.current_period_end else None
        ),
    }


@router.post("/create-checkout")
async def create_checkout_session(
    body: CheckoutRequest, db: Session = Depends(get_db)
):
    """Create a Stripe Checkout Session for the Pro plan."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    if not STRIPE_PRO_PRICE_ID:
        raise HTTPException(status_code=503, detail="Pro price ID not configured")

    sub = _get_or_create_subscription(db, body.restaurant_id)

    # Already Pro → skip
    if sub.plan == "pro" and sub.status == "active":
        return {
            "already_pro": True,
            "portal_url": f"{FRONTEND_URL}/restaurant/subscription",
        }

    checkout_params: dict = {
        "mode": "subscription",
        "line_items": [{"price": STRIPE_PRO_PRICE_ID, "quantity": 1}],
        "success_url": (
            f"{FRONTEND_URL}/restaurant/subscription?upgraded=1"
            f"&session_id={{CHECKOUT_SESSION_ID}}"
        ),
        "cancel_url": f"{FRONTEND_URL}/upgrade",
        "metadata": {"restaurant_id": body.restaurant_id},
        "allow_promotion_codes": True,
        "billing_address_collection": "required",
    }

    if body.customer_email:
        checkout_params["customer_email"] = body.customer_email

    # Attach to existing Stripe customer if we have one
    if sub.stripe_subscription_id:
        try:
            existing = stripe.Subscription.retrieve(sub.stripe_subscription_id)
            checkout_params["customer"] = existing["customer"]
        except stripe.error.StripeError:
            pass

    try:
        session = stripe.checkout.Session.create(**checkout_params)
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"checkout_url": session.url, "session_id": session.id}


@router.post("/portal")
async def create_portal_session(body: PortalRequest, db: Session = Depends(get_db)):
    """Create a Stripe Customer Portal session for billing management."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    sub = db.query(Subscription).filter(
        Subscription.restaurant_id == body.restaurant_id
    ).first()

    if not sub or not sub.stripe_subscription_id:
        raise HTTPException(
            status_code=400, detail="No active subscription found"
        )

    try:
        stripe_sub = stripe.Subscription.retrieve(sub.stripe_subscription_id)
        customer_id = stripe_sub["customer"]
        portal = stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{FRONTEND_URL}/restaurant/subscription",
        )
    except stripe.error.StripeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {"portal_url": portal.url}


@router.post("/webhook")
async def subscription_webhook(request: Request, db: Session = Depends(get_db)):
    """Handle Stripe billing webhooks: subscription created/updated/deleted."""
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")

    if STRIPE_BILLING_WEBHOOK_SECRET:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig, STRIPE_BILLING_WEBHOOK_SECRET
            )
        except (ValueError, stripe.error.SignatureVerificationError):
            raise HTTPException(status_code=400, detail="Invalid webhook signature")
    else:
        import json
        event = json.loads(payload)

    event_type = event.get("type", "")
    data = event.get("data", {}).get("object", {})

    if event_type in (
        "customer.subscription.created",
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        restaurant_id = data.get("metadata", {}).get("restaurant_id")
        if not restaurant_id:
            return {"received": True}

        sub = _get_or_create_subscription(db, restaurant_id)
        stripe_sub_id = data.get("id")
        stripe_status = data.get("status", "active")
        period_end = data.get("current_period_end")

        # Map Stripe status → our plan
        if event_type == "customer.subscription.deleted":
            sub.plan = "free"
            sub.status = "canceled"
        else:
            sub.plan = "pro" if stripe_status in ("active", "trialing") else "free"
            sub.status = stripe_status

        sub.stripe_subscription_id = stripe_sub_id
        if period_end:
            from datetime import datetime, timezone
            sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)

        db.commit()

        # Audit log
        db.add(
            AuditLog(
                actor_type="system",
                actor_id="stripe",
                action=f"subscription.{event_type.split('.')[-1]}",
                resource_type="subscription",
                resource_id=restaurant_id,
                payload={
                    "plan": sub.plan,
                    "status": sub.status,
                    "stripe_subscription_id": stripe_sub_id,
                },
            )
        )
        db.commit()

    return {"received": True}
