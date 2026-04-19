"""Payments router — Stripe Payment Intents + webhook.

Routes (prefix /api/v1/payments):
  POST /intent                           — create a PaymentIntent for cart checkout
  POST /webhook                          — Stripe signed webhook handler
  GET  /config                           — return publishable key to the frontend (safe to expose)
  GET  /{payment_intent_id}/receipt.pdf  — download payment receipt as PDF
"""

import io
import logging
from datetime import datetime

import stripe
from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
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
    STRIPE_PUBLISHABLE_KEY,
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
)
from app.db import get_db
from app.models import Payment, RestaurantProfile
from app.schemas import CreatePaymentIntentRequest, PaymentIntentResponse
from app.services.email_service import send_new_payment_email
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
        split_count=persons,
        split_index=body.split_index,
        split_total=total_cents if persons > 1 else None,
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

    # Split info
    if payment.split_count and payment.split_count > 1:
        story.append(Paragraph(
            f"Partage : personne {payment.split_index}/{payment.split_count}",
            label_style,
        ))
        if payment.split_total:
            story.append(Paragraph(
                f"Total table : {payment.split_total / 100:.2f} {payment.currency.upper()}",
                label_style,
            ))
        story.append(Spacer(1, 0.2 * cm))

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
    db: Session = Depends(get_db),
):
    """Download a PDF receipt for a succeeded payment."""
    payment = (
        db.query(Payment)
        .filter(Payment.payment_intent_id == payment_intent_id)
        .first()
    )
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")
    if payment.status != "succeeded":
        raise HTTPException(status_code=400, detail="Receipt only available for succeeded payments")

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
