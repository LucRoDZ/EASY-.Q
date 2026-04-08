"""AuditLog service — immutable logging for RGPD compliance + debugging.

Usage:
    await log_action(
        db=db,
        actor_type="user",
        actor_id="user_123",
        action="menu.create",
        resource_type="menu",
        resource_id="menu_456",
        payload={"restaurant_name": "Le Bistrot"},
        ip_address=request.client.host,
    )

    logs = await query_logs(
        db=db,
        actor_id="user_123",
        limit=50,
    )
"""

import logging
from datetime import datetime
from typing import Any

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog

logger = logging.getLogger(__name__)


async def log_action(
    db: AsyncSession,
    actor_type: str,
    action: str,
    actor_id: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Create an immutable audit log entry.

    Args:
        db: Database session
        actor_type: "user" | "system" | "admin"
        action: Action performed (e.g. "menu.create", "payment.success")
        actor_id: ID of the actor (user ID, system ID, etc.)
        resource_type: Type of resource affected (e.g. "menu", "order", "payment")
        resource_id: ID of the resource affected
        payload: Additional context data (stored as JSON)
        ip_address: IP address of the actor (IPv4 or IPv6)

    Returns:
        The created AuditLog instance

    Examples:
        # User creates a menu
        await log_action(
            db=db,
            actor_type="user",
            actor_id="user_123",
            action="menu.create",
            resource_type="menu",
            resource_id="menu_456",
            payload={"restaurant_name": "Le Bistrot", "slug": "le-bistrot"},
            ip_address="192.168.1.1",
        )

        # System processes OCR
        await log_action(
            db=db,
            actor_type="system",
            action="ocr.complete",
            resource_type="menu",
            resource_id="menu_456",
            payload={"duration_ms": 3500, "pages": 4},
        )

        # Payment succeeded
        await log_action(
            db=db,
            actor_type="system",
            action="payment.success",
            resource_type="payment",
            resource_id="pi_abc123",
            payload={"amount": 2500, "tip": 300, "currency": "eur"},
        )
    """
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
    await db.commit()
    await db.refresh(log_entry)

    logger.info(
        "audit_log created: action=%s actor=%s/%s resource=%s/%s",
        action,
        actor_type,
        actor_id,
        resource_type,
        resource_id,
    )

    return log_entry


async def query_logs(
    db: AsyncSession,
    actor_type: str | None = None,
    actor_id: str | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[AuditLog]:
    """Query audit logs with optional filters.

    Args:
        db: Database session
        actor_type: Filter by actor type ("user", "system", "admin")
        actor_id: Filter by specific actor ID
        action: Filter by action (e.g. "menu.create")
        resource_type: Filter by resource type (e.g. "menu")
        resource_id: Filter by specific resource ID
        limit: Maximum number of logs to return (default: 100, max: 1000)
        offset: Number of logs to skip (for pagination)

    Returns:
        List of AuditLog instances, ordered by created_at DESC

    Examples:
        # Get all logs for a specific user
        logs = await query_logs(db=db, actor_id="user_123", limit=50)

        # Get all payment-related logs
        logs = await query_logs(db=db, resource_type="payment", limit=100)

        # Get all system actions
        logs = await query_logs(db=db, actor_type="system", limit=200)

        # Get logs for a specific menu
        logs = await query_logs(db=db, resource_type="menu", resource_id="menu_456")
    """
    # Enforce max limit
    limit = min(limit, 1000)

    # Build query with filters
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

    # Order by created_at DESC (newest first)
    stmt = stmt.order_by(desc(AuditLog.created_at))

    # Apply pagination
    stmt = stmt.limit(limit).offset(offset)

    result = await db.execute(stmt)
    return list(result.scalars().all())


async def get_log_by_id(db: AsyncSession, log_id: int) -> AuditLog | None:
    """Retrieve a single audit log by ID.

    Args:
        db: Database session
        log_id: ID of the audit log

    Returns:
        AuditLog instance or None if not found
    """
    stmt = select(AuditLog).where(AuditLog.id == log_id)
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def count_logs(
    db: AsyncSession,
    actor_type: str | None = None,
    actor_id: str | None = None,
    action: str | None = None,
    resource_type: str | None = None,
    resource_id: str | None = None,
) -> int:
    """Count audit logs matching the given filters.

    Useful for pagination and analytics.

    Args:
        db: Database session
        actor_type: Filter by actor type
        actor_id: Filter by actor ID
        action: Filter by action
        resource_type: Filter by resource type
        resource_id: Filter by resource ID

    Returns:
        Total count of matching logs
    """
    from sqlalchemy import func

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

    result = await db.execute(stmt)
    return result.scalar_one()


# Convenience helpers for common log types

async def log_menu_action(
    db: AsyncSession,
    action: str,
    menu_id: str,
    actor_id: str | None = None,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log a menu-related action (create, update, delete, OCR)."""
    return await log_action(
        db=db,
        actor_type="user" if actor_id else "system",
        actor_id=actor_id,
        action=f"menu.{action}",
        resource_type="menu",
        resource_id=menu_id,
        payload=payload,
        ip_address=ip_address,
    )


async def log_payment_action(
    db: AsyncSession,
    action: str,
    payment_id: str,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log a payment-related action (create, success, failed, refund)."""
    return await log_action(
        db=db,
        actor_type="system",
        action=f"payment.{action}",
        resource_type="payment",
        resource_id=payment_id,
        payload=payload,
        ip_address=ip_address,
    )


async def log_order_action(
    db: AsyncSession,
    action: str,
    order_id: str,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log an order-related action (create, update, complete, cancel)."""
    return await log_action(
        db=db,
        actor_type="system",
        action=f"order.{action}",
        resource_type="order",
        resource_id=order_id,
        payload=payload,
        ip_address=ip_address,
    )


async def log_user_action(
    db: AsyncSession,
    action: str,
    user_id: str,
    payload: dict[str, Any] | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """Log a user-related action (login, logout, update_profile)."""
    return await log_action(
        db=db,
        actor_type="user",
        actor_id=user_id,
        action=f"user.{action}",
        resource_type="user",
        resource_id=user_id,
        payload=payload,
        ip_address=ip_address,
    )
