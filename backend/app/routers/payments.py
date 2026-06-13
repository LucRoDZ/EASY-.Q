"""Payments router — Stripe Payment Intents + webhook + Connect onboarding.

Routes (prefix /api/v1/payments):
  POST /intent                           — create a PaymentIntent for cart checkout
  POST /webhook                          — Stripe signed webhook handler
  GET  /config                           — return publishable key to the frontend (safe to expose)
  GET  /connect/onboard                  — create/refresh Stripe Connect Express onboarding link (owner)
  GET  /connect/status                   — Stripe Connect account status (owner)
  GET  /{payment_intent_id}/receipt.pdf  — download payment receipt as PDF
"""

import io
import logging
from datetime import datetime

import stripe
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from fastapi.responses import StreamingResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import (
    Paragraph, Spacer, SimpleDocTemplate, Table, TableStyle, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from sqlalchemy.orm import Session

from app.config import (
    FRONTEND_URL,
    IS_PRODUCTION,
    STRIPE_PLATFORM_FEE_PERCENT,
    STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
)
from app.db import get_db
from app.models import Menu, Order, Payment, RestaurantProfile
from app.schemas import CreatePaymentIntentRequest, PaymentIntentResponse
from app.services.email_service import send_new_payment_email, send_receipt_email
from app.routers.auth import require_authenticated_user
from app.routers.subscriptions import require_pro

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


# ---------------------------------------------------------------------------
# Split bill — N separate PaymentIntents for one order
# ---------------------------------------------------------------------------

class SplitRequest(BaseModel):
    order_id: int
    parts: int


@router.post("/split")
def create_split_payments(
    body: SplitRequest,
    db: Session = Depends(get_db),
):
    """Split an order total into N equal parts, each with its own PaymentIntent."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")
    if not 2 <= body.parts <= 10:
        raise HTTPException(status_code=400, detail="parts must be between 2 and 10")

    order = db.query(Order).filter(Order.id == body.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.total < 100:
        raise HTTPException(status_code=400, detail="Montant trop faible pour être partagé")

    require_pro(order.menu_slug, db)

    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == order.menu_slug).first()
    stripe_account_id = profile.stripe_account_id if profile else None

    # ceil(total/parts) so the sum always covers the order total
    part_amount = -(-order.total // body.parts)
    if part_amount < 50:
        raise HTTPException(status_code=400, detail="Chaque part doit être d'au moins 0,50 €")

    parts: list[dict] = []
    for i in range(body.parts):
        intent_params: dict = {
            "amount": part_amount,
            "currency": order.currency,
            "capture_method": "automatic",
            "metadata": {
                "menu_slug": order.menu_slug,
                "table_token": order.table_token or "",
                "order_id": str(order.id),
                "split_part": f"{i + 1}/{body.parts}",
            },
            "automatic_payment_methods": {"enabled": True},
        }
        if stripe_account_id:
            fee = max(1, int(part_amount * STRIPE_PLATFORM_FEE_PERCENT))
            intent_params["application_fee_amount"] = fee
            intent_params["transfer_data"] = {"destination": stripe_account_id}

        try:
            intent = stripe.PaymentIntent.create(**intent_params)
        except stripe.StripeError as e:
            logger.error("Stripe split intent error: %s", e)
            db.rollback()
            raise HTTPException(status_code=502, detail=str(e))

        payment = Payment(
            menu_slug=order.menu_slug,
            table_token=order.table_token,
            order_id=order.id,
            payment_intent_id=intent.id,
            amount=part_amount,
            tip_amount=0,
            currency=order.currency,
            status="pending",
            items=order.items,
            split_count=body.parts,
            split_index=i + 1,
            split_total=order.total,
        )
        db.add(payment)
        parts.append({
            "part": i + 1,
            "amount": part_amount,
            "client_secret": intent.client_secret,
            "payment_intent_id": intent.id,
        })

    db.commit()

    return {
        "order_id": order.id,
        "total": order.total,
        "currency": order.currency,
        "parts": parts,
    }


# ---------------------------------------------------------------------------
# Stripe Connect — restaurant onboarding & status
# ---------------------------------------------------------------------------

def _get_owned_profile(slug: str, user: dict, db: Session) -> RestaurantProfile:
    """Return the RestaurantProfile for slug, asserting the caller owns the menu."""
    menu = db.query(Menu).filter(Menu.slug == slug).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")
    if menu.restaurant_id != user["sub"]:
        raise HTTPException(status_code=403, detail="Access denied")

    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == slug).first()
    if not profile:
        profile = RestaurantProfile(slug=slug, name=menu.restaurant_name or slug)
        db.add(profile)
        db.flush()
    return profile


@router.get("/connect/onboard")
def connect_onboard(
    slug: str,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    """Create (or reuse) a Stripe Connect Express account and return an onboarding URL."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    profile = _get_owned_profile(slug, user, db)

    try:
        if not profile.stripe_account_id:
            account = stripe.Account.create(
                type="express",
                country="FR",
                capabilities={
                    "card_payments": {"requested": True},
                    "transfers": {"requested": True},
                },
                metadata={"menu_slug": slug},
            )
            profile.stripe_account_id = account.id
            db.commit()

        link = stripe.AccountLink.create(
            account=profile.stripe_account_id,
            refresh_url=f"{FRONTEND_URL}/restaurant/{slug}/settings?connect=refresh",
            return_url=f"{FRONTEND_URL}/restaurant/{slug}/settings?connect=done",
            type="account_onboarding",
        )
    except stripe.StripeError as e:
        logger.error("Stripe Connect onboarding error for %s: %s", slug, e)
        raise HTTPException(status_code=502, detail=str(e))

    return {"url": link.url, "stripe_account_id": profile.stripe_account_id}


@router.get("/connect/status")
def connect_status(
    slug: str,
    db: Session = Depends(get_db),
    user: dict = Depends(require_authenticated_user),
):
    """Return the Stripe Connect account status for this restaurant."""
    if not STRIPE_SECRET_KEY:
        raise HTTPException(status_code=503, detail="Stripe not configured")

    profile = _get_owned_profile(slug, user, db)
    if not profile.stripe_account_id:
        return {"connected": False, "charges_enabled": False, "details_submitted": False}

    try:
        account = stripe.Account.retrieve(profile.stripe_account_id)
    except stripe.StripeError as e:
        logger.error("Stripe Connect status error for %s: %s", slug, e)
        raise HTTPException(status_code=502, detail=str(e))

    return {
        "connected": True,
        "stripe_account_id": profile.stripe_account_id,
        "charges_enabled": bool(account.get("charges_enabled")),
        "details_submitted": bool(account.get("details_submitted")),
        "payouts_enabled": bool(account.get("payouts_enabled")),
    }


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

    # Payments are a Pro-only feature — gate by the menu slug as restaurant_id
    require_pro(body.slug, db)

    # Calculate totals server-side
    subtotal = sum(item.price * item.quantity for item in body.items)
    tip = max(0.0, body.tip_amount)
    total_euros = subtotal + tip
    amount_cents = _euros_to_cents(total_euros)
    tip_cents = _euros_to_cents(tip)

    if amount_cents < 50:  # Stripe minimum: 0.50 EUR
        raise HTTPException(
            status_code=400,
            detail="Le montant minimum est de 0,50 €",
        )

    # Look up restaurant's Stripe Connect account
    profile = db.query(RestaurantProfile).filter(RestaurantProfile.slug == body.slug).first()
    stripe_account_id = profile.stripe_account_id if profile else None

    # Create the Order first so its id can be embedded in the PaymentIntent metadata
    from app.routers.orders import _next_pickup_number
    pickup_number = None if body.table_token else _next_pickup_number(db, body.slug)
    order = Order(
        menu_slug=body.slug,
        table_token=body.table_token,
        items=[item.model_dump() for item in body.items],
        total=amount_cents,
        currency=body.currency.lower(),
        status="pending",
        pickup_number=pickup_number,
    )
    db.add(order)
    db.flush()  # assign order.id without committing yet

    # Build PaymentIntent params — add Connect split when account is configured
    intent_params: dict = {
        "amount": amount_cents,
        "currency": body.currency.lower(),
        "capture_method": "automatic",
        "metadata": {
            "menu_slug": body.slug,
            "table_token": body.table_token or "",
            "order_id": str(order.id),
        },
        "automatic_payment_methods": {"enabled": True},
    }
    if stripe_account_id:
        fee = max(1, int(amount_cents * STRIPE_PLATFORM_FEE_PERCENT))
        intent_params["application_fee_amount"] = fee
        intent_params["transfer_data"] = {"destination": stripe_account_id}

    # Create PaymentIntent
    try:
        intent = stripe.PaymentIntent.create(**intent_params)
    except stripe.StripeError as e:
        logger.error("Stripe PaymentIntent error: %s", e)
        db.rollback()
        raise HTTPException(status_code=502, detail=str(e))

    # Persist a payment record linked to the order
    payment = Payment(
        menu_slug=body.slug,
        table_token=body.table_token,
        order_id=order.id,
        payment_intent_id=intent.id,
        amount=amount_cents,
        tip_amount=tip_cents,
        currency=body.currency.lower(),
        status="pending",
        items=[item.model_dump() for item in body.items],
    )
    db.add(payment)
    db.flush()
    order.payment_id = payment.id
    db.commit()
    db.refresh(order)

    return PaymentIntentResponse(
        client_secret=intent.client_secret,
        payment_intent_id=intent.id,
        amount=amount_cents,
        currency=body.currency.lower(),
        order_id=order.id,
    )


def _send_receipt_background(
    payment_intent_id: str,
    menu_slug: str,
    table_token: str | None,
    amount_cents: int,
    customer_email: str | None = None,
) -> None:
    """Send payment notifications: owner alert + customer receipt. Best-effort."""
    from app.db import SessionLocal
    db = SessionLocal()
    try:
        profile = (
            db.query(RestaurantProfile)
            .filter(RestaurantProfile.slug == menu_slug)
            .first()
        )
        restaurant_name = profile.name if profile and profile.name else menu_slug

        if profile and profile.owner_email:
            table_label = f"Token {table_token[:8]}" if table_token else "Sans table"
            try:
                send_new_payment_email(
                    to=profile.owner_email,
                    amount=amount_cents / 100,
                    table=table_label,
                )
            except Exception as exc:
                logger.warning("Owner payment email failed for %s: %s", payment_intent_id, exc)

        # Customer receipt (Stripe collects receipt_email at checkout)
        if customer_email:
            payment = (
                db.query(Payment)
                .filter(Payment.payment_intent_id == payment_intent_id)
                .first()
            )
            try:
                send_receipt_email(
                    to=customer_email,
                    restaurant_name=restaurant_name,
                    items=payment.items if payment else [],
                    amount_cents=amount_cents,
                    tip_cents=payment.tip_amount if payment else 0,
                    payment_intent_id=payment_intent_id,
                    currency=payment.currency if payment else "eur",
                )
            except Exception as exc:
                logger.warning("Customer receipt email failed for %s: %s", payment_intent_id, exc)
    except Exception as exc:
        logger.warning("Receipt email failed for payment %s: %s", payment_intent_id, exc)
    finally:
        db.close()


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
        if IS_PRODUCTION:
            raise HTTPException(status_code=500, detail="Webhook secret not configured")
        # Dev mode only: accept unsigned events for local testing
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
        except stripe.error.SignatureVerificationError:
            raise HTTPException(status_code=400, detail="Invalid Stripe signature")
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Webhook error: {e}")

    intent_id: str | None = None
    metadata_order_id: int | None = None
    event_type: str = event["type"]

    if event_type in ("payment_intent.succeeded", "payment_intent.payment_failed"):
        pi = event["data"]["object"]
        intent_id = pi.get("id")
        try:
            raw_order_id = (pi.get("metadata") or {}).get("order_id")
            metadata_order_id = int(raw_order_id) if raw_order_id else None
        except (TypeError, ValueError):
            metadata_order_id = None

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
                background_tasks.add_task(
                    _send_receipt_background,
                    payment.payment_intent_id,
                    payment.menu_slug,
                    payment.table_token,
                    payment.amount,
                    pi.get("receipt_email"),
                )
                # Confirm the order and broadcast to KDS.
                # Resolve by explicit link (Payment.order_id or PI metadata),
                # falling back to the legacy slug+token+pending lookup.
                order_id = payment.order_id or metadata_order_id
                order = None
                if order_id:
                    order = db.query(Order).filter(Order.id == order_id).first()
                if not order:
                    order = (
                        db.query(Order)
                        .filter(
                            Order.menu_slug == payment.menu_slug,
                            Order.table_token == payment.table_token,
                            Order.status == "pending",
                        )
                        .order_by(Order.created_at.desc())
                        .first()
                    )
                # Split bill: confirm the order only once every part is paid
                if order and payment.split_count and payment.split_count > 1:
                    db.flush()
                    succeeded_parts = (
                        db.query(Payment)
                        .filter(
                            Payment.order_id == order.id,
                            Payment.split_count == payment.split_count,
                            Payment.status == "succeeded",
                        )
                        .count()
                    )
                    if succeeded_parts < payment.split_count:
                        logger.info(
                            "Split payment %s: %d/%d parts paid for order %s",
                            intent_id, succeeded_parts, payment.split_count, order.id,
                        )
                        order = None  # don't confirm yet

                if order:
                    order.status = "confirmed"
                    if not payment.order_id:
                        payment.order_id = order.id
                    if not order.payment_id:
                        order.payment_id = payment.id
                    db.flush()
                    table = None
                    if order.table_token:
                        from app.models import Table as TableModel
                        table = (
                            db.query(TableModel)
                            .filter(TableModel.qr_token == order.table_token)
                            .first()
                        )
                    background_tasks.add_task(
                        _broadcast_order_confirmed,
                        order.id,
                        order.menu_slug,
                        order.table_token,
                        order.items or [],
                        order.pickup_number,
                        table.number if table else None,
                        table.label if table else None,
                    )
            elif event_type == "payment_intent.payment_failed":
                payment.status = "failed"
                logger.warning("Payment %s failed", intent_id)
            db.commit()

    return {"received": True}


async def _broadcast_order_confirmed(
    order_id: int,
    menu_slug: str,
    table_token: str | None,
    items: list,
    pickup_number: int | None,
    table_number: str | None = None,
    table_label: str | None = None,
) -> None:
    """Best-effort: broadcast order confirmed event to KDS via Redis."""
    from app.core.redis import publish_order_event
    try:
        await publish_order_event(
            menu_slug,
            {
                "type": "new_order",
                "order": {
                    "id": order_id,
                    "menu_slug": menu_slug,
                    "table_token": table_token,
                    "table_number": table_number,
                    "table_label": table_label,
                    "items": items,
                    "status": "confirmed",
                    "pickup_number": pickup_number,
                },
            },
        )
    except Exception as exc:
        logger.warning("KDS broadcast failed for order %s: %s", order_id, exc)

    order_payload = {
        "id": order_id,
        "menu_slug": menu_slug,
        "table_token": table_token,
        "table_number": table_number,
        "table_label": table_label,
        "items": items,
        "status": "confirmed",
        "pickup_number": pickup_number,
    }

    # Notify the client tracking page (best-effort)
    from app.routers.kds import publish_order_tracking_event
    await publish_order_tracking_event(order_payload)

    # Notify the waiter screen (best-effort)
    try:
        from app.core.redis import publish_waiter_event
        await publish_waiter_event(menu_slug, {"type": "new_order", "order": order_payload})
    except Exception as exc:
        logger.warning("Waiter new_order publish failed for order %s: %s", order_id, exc)


# ---------------------------------------------------------------------------
# PDF Receipt
# ---------------------------------------------------------------------------

def _build_receipt_pdf(payment: Payment, restaurant_name: str) -> bytes:
    """Generate a PDF receipt for a payment using reportlab."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "title", parent=styles["Heading1"], alignment=TA_CENTER, fontSize=22, spaceAfter=4
    )
    sub_style = ParagraphStyle(
        "sub", parent=styles["Normal"], alignment=TA_CENTER, fontSize=10,
        textColor=colors.HexColor("#737373"), spaceAfter=16
    )
    label_style = ParagraphStyle(
        "label", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#737373")
    )
    value_style = ParagraphStyle(
        "value", parent=styles["Normal"], fontSize=11, textColor=colors.HexColor("#171717")
    )
    total_style = ParagraphStyle(
        "total", parent=styles["Normal"], fontSize=16, fontName="Helvetica-Bold",
        alignment=TA_RIGHT, textColor=colors.HexColor("#171717")
    )

    paid_at = payment.created_at or datetime.now()
    paid_str = paid_at.strftime("%d/%m/%Y à %H:%M") if hasattr(paid_at, "strftime") else str(paid_at)
    amount_str = f"{payment.amount / 100:.2f} {payment.currency.upper()}"

    story = [
        Paragraph("EASY.Q", title_style),
        Paragraph("Reçu de paiement", sub_style),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e5e5")),
        Spacer(1, 0.4 * cm),
        Paragraph("Restaurant", label_style),
        Paragraph(restaurant_name, value_style),
        Spacer(1, 0.2 * cm),
        Paragraph("Date", label_style),
        Paragraph(paid_str, value_style),
        Spacer(1, 0.2 * cm),
        Paragraph("Référence", label_style),
        Paragraph(payment.payment_intent_id or "—", ParagraphStyle(
            "ref", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#404040")
        )),
        Spacer(1, 0.4 * cm),
        HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e5e5")),
        Spacer(1, 0.4 * cm),
    ]

    # Items table
    items = payment.items or []
    if items:
        table_data = [["Article", "Qté", "Prix"]]
        for item in items:
            name = item.get("name", "?")
            qty = str(item.get("quantity", 1))
            price = f"{item.get('price', 0):.2f} €"
            table_data.append([name, qty, price])

        col_widths = [10 * cm, 2 * cm, 4 * cm]
        t = Table(table_data, colWidths=col_widths)
        t.setStyle(TableStyle([
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, 0), 9),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#737373")),
            ("FONTSIZE", (0, 1), (-1, -1), 11),
            ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#171717")),
            ("ALIGN", (1, 0), (1, -1), "CENTER"),
            ("ALIGN", (2, 0), (2, -1), "RIGHT"),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, colors.HexColor("#e5e5e5")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(t)
        story.append(Spacer(1, 0.4 * cm))
        story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e5e5")))
        story.append(Spacer(1, 0.3 * cm))

    # Tip
    if payment.tip_amount and payment.tip_amount > 0:
        tip_str = f"Pourboire : {payment.tip_amount / 100:.2f} {payment.currency.upper()}"
        story.append(Paragraph(tip_str, label_style))
        story.append(Spacer(1, 0.1 * cm))

    story.append(Paragraph(f"Total payé : {amount_str}", total_style))
    story.append(Spacer(1, 0.6 * cm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#e5e5e5")))
    story.append(Spacer(1, 0.3 * cm))
    story.append(Paragraph(
        "Merci pour votre visite. Ce reçu est généré automatiquement par EASY.Q.",
        ParagraphStyle("footer", parent=styles["Normal"], fontSize=8,
                       textColor=colors.HexColor("#a3a3a3"), alignment=TA_CENTER),
    ))

    doc.build(story)
    return buf.getvalue()


@router.get("/{payment_intent_id}/receipt.pdf")
def download_receipt(
    payment_intent_id: str,
    table_token: str | None = None,
    db: Session = Depends(get_db),
):
    """Download a PDF receipt for a succeeded payment.

    When the payment is associated with a table, the caller must supply the
    matching table_token as a query parameter to prove they were at that table.
    """
    payment = (
        db.query(Payment)
        .filter(Payment.payment_intent_id == payment_intent_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status != "succeeded":
        raise HTTPException(status_code=400, detail="Receipt only available for succeeded payments")
    if payment.table_token and payment.table_token != table_token:
        raise HTTPException(status_code=403, detail="Invalid table_token for this receipt")

    # Look up restaurant name
    profile = (
        db.query(RestaurantProfile)
        .filter(RestaurantProfile.slug == payment.menu_slug)
        .first()
    )
    restaurant_name = profile.name if profile else payment.menu_slug

    pdf_bytes = _build_receipt_pdf(payment, restaurant_name)

    filename = f"receipt-{payment_intent_id[-8:]}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
