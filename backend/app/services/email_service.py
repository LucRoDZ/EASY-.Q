"""Transactional email service via Resend.

Required env var:
  RESEND_API_KEY      — Resend API key (re_xxxx...)
  RESEND_FROM_EMAIL   — Sender address (e.g. noreply@easy-q.app)

Usage:
  from app.services.email_service import send_new_payment_email
  send_new_payment_email(to="owner@resto.fr", amount=42.50, table="Table 5")

All functions are synchronous (Resend SDK is sync). Call from FastAPI background
tasks or fire-and-forget for non-critical notifications.

Functions return the Resend response dict on success, or None if the API key is
not configured (graceful degradation in dev/test).
"""

import logging
from datetime import datetime
from typing import Any

import resend as _resend

from app.config import RESEND_API_KEY, RESEND_FROM_EMAIL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def email_configured() -> bool:
    """Return True only when a non-empty Resend API key is set."""
    return bool(RESEND_API_KEY)


def _configure() -> None:
    """Set the global Resend API key once."""
    if email_configured() and not _resend.api_key:
        _resend.api_key = RESEND_API_KEY


def _send(to: str | list[str], subject: str, html: str) -> dict[str, Any] | None:
    """Low-level send helper. Returns None (no-op) if Resend is not configured."""
    _configure()
    if not email_configured():
        logger.warning("email: RESEND_API_KEY not configured — skipping '%s' to %s", subject, to)
        return None

    recipients = [to] if isinstance(to, str) else to
    params: _resend.Emails.SendParams = {
        "from": RESEND_FROM_EMAIL,
        "to": recipients,
        "subject": subject,
        "html": html,
    }
    try:
        response = _resend.Emails.send(params)
        logger.info("email: sent '%s' to %s (id=%s)", subject, recipients, getattr(response, "id", "?"))
        return response
    except Exception as exc:
        logger.error("email: failed '%s' to %s — %s", subject, recipients, exc)
        raise


# ---------------------------------------------------------------------------
# HTML templates (inline — no separate template files needed)
# ---------------------------------------------------------------------------

_BASE_STYLE = """
body { margin:0; padding:0; background:#f5f5f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
.wrap { max-width:560px; margin:32px auto; background:#fff; border-radius:12px; overflow:hidden; border:1px solid #e5e5e5; }
.header { background:#000; color:#fff; padding:28px 32px; }
.header h1 { margin:0; font-size:20px; font-weight:600; letter-spacing:-0.3px; }
.header p  { margin:4px 0 0; font-size:13px; color:#a3a3a3; }
.body { padding:28px 32px; color:#171717; }
.body p  { margin:0 0 12px; font-size:15px; line-height:1.6; color:#404040; }
.amount { font-size:32px; font-weight:700; color:#171717; margin:16px 0; }
.badge  { display:inline-block; background:#f5f5f5; border:1px solid #e5e5e5; border-radius:999px; padding:4px 12px; font-size:12px; color:#525252; }
.table-grid { width:100%; border-collapse:collapse; margin:16px 0; font-size:14px; }
.table-grid th { text-align:left; color:#737373; font-weight:500; border-bottom:1px solid #e5e5e5; padding:6px 0; }
.table-grid td { padding:8px 0; border-bottom:1px solid #f5f5f5; color:#262626; }
.btn { display:inline-block; background:#000; color:#fff !important; padding:12px 24px; border-radius:999px; text-decoration:none; font-size:14px; font-weight:500; margin-top:16px; }
.footer { padding:20px 32px; border-top:1px solid #f5f5f5; font-size:12px; color:#a3a3a3; }
"""


def _wrap(header_title: str, header_sub: str, body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<style>{_BASE_STYLE}</style>
</head><body>
<div class="wrap">
  <div class="header">
    <h1>{header_title}</h1>
    <p>{header_sub}</p>
  </div>
  <div class="body">{body_html}</div>
  <div class="footer">EASY.Q — Gestion de restaurant simplifiée<br>
  Vous recevez cet email car vous êtes propriétaire d'un restaurant sur EASY.Q.</div>
</div>
</body></html>"""


# ---------------------------------------------------------------------------
# Public send functions
# ---------------------------------------------------------------------------

def send_welcome_email(to: str, restaurant_name: str) -> dict[str, Any] | None:
    """Send welcome email after restaurant onboarding."""
    html = _wrap(
        header_title="Bienvenue sur EASY.Q 🎉",
        header_sub="Votre restaurant est prêt",
        body_html=f"""
<p>Bonjour,</p>
<p>Votre restaurant <strong>{restaurant_name}</strong> est maintenant actif sur EASY.Q.</p>
<p>Vous pouvez dès maintenant :</p>
<ul style="color:#404040;font-size:15px;line-height:1.8;margin:0 0 16px;">
  <li>Uploader votre carte en PDF</li>
  <li>Générer vos QR codes de table</li>
  <li>Activer le chatbot IA pour vos clients</li>
</ul>
<a href="https://easy-q.app/restaurant/dashboard" class="btn">Accéder au tableau de bord</a>
""",
    )
    return _send(to, f"Bienvenue sur EASY.Q — {restaurant_name}", html)


def send_new_payment_email(
    to: str,
    amount: float,
    table: str,
    paid_at: datetime | None = None,
) -> dict[str, Any] | None:
    """Send payment received notification to restaurant owner."""
    time_str = (paid_at or datetime.now()).strftime("%d/%m/%Y à %H:%M")
    html = _wrap(
        header_title="Paiement reçu",
        header_sub=f"{table} · {time_str}",
        body_html=f"""
<p>Un nouveau paiement a été enregistré.</p>
<div class="amount">{amount:.2f} €</div>
<p><span class="badge">{table}</span>&nbsp; <span class="badge">{time_str}</span></p>
<p>Le paiement a été traité avec succès via Stripe.</p>
""",
    )
    return _send(to, f"Paiement reçu — {amount:.2f} € ({table})", html)


def send_low_nps_email(
    to: str,
    nps_score: int,
    comment: str = "",
    slug: str = "",
) -> dict[str, Any] | None:
    """Alert restaurant owner when an NPS score is below 7 (detractors)."""
    score_label = "😟" if nps_score <= 3 else "😐"
    comment_block = (
        f"<p><em style='color:#737373'>« {comment} »</em></p>" if comment else ""
    )
    slug_line = f"<p><span class='badge'>{slug}</span></p>" if slug else ""
    html = _wrap(
        header_title="Avis client — Score NPS faible",
        header_sub=f"NPS : {nps_score}/10 {score_label}",
        body_html=f"""
<p>Un client a donné un score NPS de <strong>{nps_score}/10</strong>.</p>
<p style="font-size:36px;margin:12px 0;">{score_label} <strong>{nps_score}</strong><span style="font-size:18px;color:#737373">/10</span></p>
{comment_block}
{slug_line}
<p>Un score inférieur à 7 indique un client insatisfait. Pensez à analyser l'expérience proposée.</p>
""",
    )
    return _send(to, f"NPS {nps_score}/10 — Client insatisfait", html)


def send_bad_review_email(
    to: str,
    score: int,
    comment: str = "",
    table: str = "",
) -> dict[str, Any] | None:
    """Alert owner when a review score is below 3 stars."""
    stars = "⭐" * score + "☆" * (5 - score)
    comment_block = (
        f"<p><em style='color:#737373'>« {comment} »</em></p>" if comment else ""
    )
    table_line = f"<p><span class='badge'>{table}</span></p>" if table else ""
    html = _wrap(
        header_title="Avis client — Note faible",
        header_sub=f"Note : {score}/5 {stars}",
        body_html=f"""
<p>Un client a laissé une note inférieure à 3 étoiles.</p>
<p style="font-size:24px;margin:12px 0;">{stars}</p>
{comment_block}
{table_line}
<p>Pensez à contacter le client ou à identifier une piste d'amélioration.</p>
""",
    )
    return _send(to, f"Avis {score}/5 — Action recommandée", html)


def send_new_order_email(
    to: str,
    items: list[dict],
    table: str,
) -> dict[str, Any] | None:
    """Notify owner of a new order when KDS is inactive."""
    rows = "".join(
        f"<tr><td>{it.get('name', '?')}</td><td>×{it.get('qty', 1)}</td></tr>"
        for it in items
    )
    html = _wrap(
        header_title="Nouvelle commande",
        header_sub=table,
        body_html=f"""
<p>Une nouvelle commande vient d'être passée depuis <strong>{table}</strong>.</p>
<table class="table-grid">
  <thead><tr><th>Plat</th><th>Qté</th></tr></thead>
  <tbody>{rows}</tbody>
</table>
<p style="font-size:13px;color:#737373;">Le KDS n'est pas actif — vous gérez les commandes manuellement.</p>
""",
    )
    return _send(to, f"Nouvelle commande — {table}", html)


def send_subscription_renewal_email(
    to: str,
    plan: str,
    renewal_date: str,
) -> dict[str, Any] | None:
    """Remind owner 3 days before subscription renewal."""
    html = _wrap(
        header_title="Rappel de renouvellement",
        header_sub=f"Plan {plan.upper()} · {renewal_date}",
        body_html=f"""
<p>Votre abonnement EASY.Q <strong>{plan.upper()}</strong> sera renouvelé dans <strong>3 jours</strong>
   le <strong>{renewal_date}</strong>.</p>
<p>Aucune action n'est requise si vous souhaitez continuer. Pour modifier votre abonnement :</p>
<a href="https://easy-q.app/restaurant/billing" class="btn">Gérer mon abonnement</a>
""",
    )
    return _send(to, f"Renouvellement dans 3 jours — Plan {plan.upper()}", html)
