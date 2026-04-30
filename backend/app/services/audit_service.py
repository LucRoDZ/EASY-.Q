"""AuditLog service — immutable logging for RGPD compliance + debugging.

Usage:
    log_action(
        db=db,
        actor_type="user",
        actor_id="user_123",
        action="menu.create",
        resource_type="menu",
        resource_id="menu_456",
        payload={"restaurant_name": "Le Bistrot"},
        ip_address=request.client.host,
    )

    logs = query_logs(
        db=db,
        actor_id="user_123",
        limit=50,
    )
"""

import logging
from typing import Any

from sqlalchemy import desc, func, select
from sqlalchemy.orm import Session

from app.models import AuditLog

logger = logging.getLogger(__name__)


def log_action(
    db: Session,
    actor_type: str,
    action: str,
    actor_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Create an immutable audit log entry."""
    log_entry = AuditLog(
        actor_type=actor_type,
        actor_id=actor_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        payload=payload or {},
        ip_address=ip_address,
    )

    db.add(log_entry)
    db.commit()
    db.refresh(log_entry)

    logger.info(
        "audit_log created: action=%s actor=%s/%s resource=%s/%s",
        action,
        actor_type,
        actor_id,
        resource_type,
        resource_id,
    )

    return log_entry


def query_logs(
    db: Session,
    actor_type: str | None = None,
    actor_id: str | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AuditLog]:
    """Query audit logs with optional filters, ordered by created_at DESC."""
    limit = min(limit, 1000)

    stmt = select(AuditLog)

    if actor_type:
        stmt = stmt.where(AuditLog.actor_type == actor_type)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)

    stmt = stmt.order_by(desc(AuditLog.created_at), desc(AuditLog.id))
    stmt = stmt.limit(limit).offset(offset)

    return list(db.execute(stmt).scalars().all())


def get_log_by_id(db: Session, log_id: int) -> AuditLog | None:
    """Retrieve a single audit log by ID."""
    stmt = select(AuditLog).where(AuditLog.id == log_id)
    return db.execute(stmt).scalar_one_or_none()


def count_logs(
    db: Session,
    actor_type: str | None = None,
    actor_id: str | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> int:
    """Count audit logs matching the given filters."""
    stmt = select(func.count()).select_from(AuditLog)

    if actor_type:
        stmt = stmt.where(AuditLog.actor_type == actor_type)
    if actor_id:
        stmt = stmt.where(AuditLog.actor_id == actor_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    if resource_type:
        stmt = stmt.where(AuditLog.resource_type == resource_type)
    if resource_id:
        stmt = stmt.where(AuditLog.resource_id == resource_id)

    return db.execute(stmt).scalar_one()


# Convenience helpers for common log types

def log_menu_action(
    db: Session,
    action: str,
    menu_id: str,
    actor_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log a menu-related action (create, update, delete, OCR)."""
    return log_action(
        db=db,
        actor_type="user" if actor_id else "system",
        actor_id=actor_id,
        action=f"menu.{action}",
        resource_type="menu",
        resource_id=menu_id,
        payload=payload,
        ip_address=ip_address,
    )


def log_payment_action(
    db: Session,
    action: str,
    payment_id: str,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log a payment-related action (create, success, failed, refund)."""
    return log_action(
        db=db,
        actor_type="system",
        action=f"payment.{action}",
        resource_type="payment",
        resource_id=payment_id,
        payload=payload,
        ip_address=ip_address,
    )


def log_order_action(
    db: Session,
    action: str,
    order_id: str,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log an order-related action (create, update, complete, cancel)."""
    return log_action(
        db=db,
        actor_type="system",
        action=f"order.{action}",
        resource_type="order",
        resource_id=order_id,
        payload=payload,
        ip_address=ip_address,
    )


def log_user_action(
    db: Session,
    action: str,
    user_id: str,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log a user-related action (login, logout, update_profile)."""
    return log_action(
        db=db,
        actor_type="user",
        actor_id=user_id,
        action=f"user.{action}",
        resource_type="user",
        resource_id=user_id,
        payload=payload,
        ip_address=ip_address,
    )
