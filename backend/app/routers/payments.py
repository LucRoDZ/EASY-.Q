"""Payments router — Stripe Payment Intents + webhook.

Routes (prefix /api/v1/payments):
  POST /intent    — create a PaymentIntent for cart checkout
  POST /webhook   — Stripe signed webhook handler
  GET  /config    — return publishable key to the frontend (safe to expose)
"""

import logging

import stripe
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

from app.config import (
    STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
)
from app.db import get_db
from app.models import Payment, RestaurantProfile
from app.schemas import CreatePaymentIntentRequest, PaymentIntentResponse
from app.services.email_service import send_new_payment_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/payments", tags=["payments"])

# Configure Stripe SDK
stripe.api_key = STRIPE_SECRET_KEY


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _euros_to_cents(amount: float) -> int:
    """Convert a euro amount to integer cents, rounding to nearest cent."""
    return round(amount * 100)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/config")
def get_stripe_config():
    """Return the publishable key so the frontend can initialise Stripe.js."""
    return {"publishable_key": STRIPE_PUBLISHABLE_KEY}


@router.post("/intent", response_model=PaymentIntentResponse)
def create_payment_intent(
    body: CreatePaymentIntentRequest,
    db: Session = Depends(get_db),
):
    """Create a Stripe PaymentIntent from the client's cart.

    Amount is calculated server-side from the provided items.
    The tip_amount is added on top.
    """
    if not STRIPE_SECRET_KEY:
        raise HTTPException(
            status_code=503,
            detail="Stripe not configured — set STRIPE_SECRET_KEY",
        )

    # Calculate totals server-side
    subtotal = sum(item.price * item.quantity for item in body.items)
    tip = max(0.0, body.tip_amount)
    total_euros = subtotal + tip
    total_cents = _euros_to_cents(total_euros)
    tip_cents = _euros_to_cents(tip)

    # Split bill: divide total across persons
    persons = max(1, body.split_persons)
    if persons > 1:
        per_person_cents = total_cents // persons
        # Last person pays remainder to avoid rounding loss
        if body.split_index >= persons:
            amount_cents = total_cents - per_person_cents * (persons - 1)
        else:
            amount_cents = per_person_cents
    else:
        amount_cents = total_cents

    if amount_cents < 50:  # Stripe minimum: 0.50 EUR
        raise HTTPException(
            status_code=400,
            detail="Le montant minimum est de 0,50 €",
        )

    # Create PaymentIntent
    try:
        intent = stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=body.currency.lower(),
            capture_method="automatic",
            metadata={
                "menu_slug": body.slug,
                "table_token": body.table_token or "",
                "split_persons": str(persons),
                "split_index": str(body.split_index),
                "split_total": str(total_cents),
            },
            automatic_payment_methods={"enabled": True},
        )
    except stripe.StripeError as e:
        logger.error("Stripe PaymentIntent error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))

    # Persist a payment record
    payment = Payment(
        menu_slug=body.slug,
        table_token=body.table_token,
        payment_intent_id=intent.id,
        amount=amount_cents,
        tip_amount=tip_cents,
        currency=body.currency.lower(),
        status="pending",
        items=[item.model_dump() for item in body.items],
    )
    db.add(payment)
    db.commit()

    return PaymentIntentResponse(
        client_secret=intent.client_secret,
        payment_intent_id=intent.id,
        amount=amount_cents,
        currency=body.currency.lower(),
        split_total=total_cents if persons > 1 else None,
        split_persons=persons,
    )


def _send_receipt_background(db: Session, payment: Payment) -> None:
    """Send payment receipt email to restaurant owner. Best-effort."""
    try:
        profile = (
            db.query(RestaurantProfile)
            .filter(RestaurantProfile.slug == payment.menu_slug)
            .first()
        )
        if not profile or not profile.owner_email:
            return
        table_label = f"Token {payment.table_token[:8]}" if payment.table_token else "Sans table"
        send_new_payment_email(
            to=profile.owner_email,
            amount=payment.amount / 100,
            table=table_label,
        )
    except Exception as exc:
        logger.warning("Receipt email failed for payment %s: %s", payment.payment_intent_id, exc)


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    stripe_signature: str = Header(None, alias="stripe-signature"),
    db: Session = Depends(get_db),
):
    """Handle signed Stripe webhook events.

    Supported events:
    - payment_intent.succeeded  → mark Payment as succeeded
    - payment_intent.payment_failed → mark Payment as failed
    """
    payload = await request.body()

    if not STRIPE_WEBHOOK_SECRET:
        # Dev mode: accept unsigned events for local testing
        try:
            event = stripe.Event.construct_from(
                stripe.util.convert_to_stripe_object(
                    stripe.util.json.loads(payload)
                ),
                stripe.api_key,
            )
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid payload: {e}")
    else:
        try:
            event = stripe.Webhook.construct_event(
                payload, stripe_signature, STRIPE_WEBHOOK_SECRET
            )
        except stripe.errors.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid Stripe signature")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Webhook error: {e}")

    intent_id: str | None = None
    event_type: str = event["type"]

    if event_type in ("payment_intent.succeeded", "payment_intent.payment_failed"):
        pi = event["data"]["object"]
        intent_id = pi.get("id")

    if intent_id:
        payment = (
            db.query(Payment)
            .filter(Payment.payment_intent_id == intent_id)
            .first()
        )
        if payment:
            if event_type == "payment_intent.succeeded":
                payment.status = "succeeded"
                logger.info("Payment %s succeeded (€%.2f)", intent_id, payment.amount / 100)
                background_tasks.add_task(_send_receipt_background, db, payment)
            elif event_type == "payment_intent.payment_failed":
                payment.status = "failed"
                logger.warning("Payment %s failed", intent_id)
            db.commit()

    return {"received": True}
