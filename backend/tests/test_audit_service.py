"""Tests for audit_service.py"""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import AuditLog
from app.services.audit_service import (
    log_action,
    query_logs,
    get_log_by_id,
    count_logs,
    log_menu_action,
    log_payment_action,
)

# Test database URL (in-memory SQLite for fast tests)
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"


@pytest.fixture
async def db_session():
    """Create a fresh database session for each test."""
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Create all tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with async_session() as session:
        yield session

    # Cleanup
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest.mark.asyncio
async def test_log_action_creates_entry(db_session: AsyncSession):
    """Test that log_action creates an audit log entry."""
    log = await log_action(
        db=db_session,
        actor_type="user",
        actor_id="user_123",
        action="menu.create",
        resource_type="menu",
        resource_id="menu_456",
        payload={"restaurant_name": "Le Bistrot"},
        ip_address="192.168.1.1",
    )

    assert log.id is not None
    assert log.actor_type == "user"
    assert log.actor_id == "user_123"
    assert log.action == "menu.create"
    assert log.resource_type == "menu"
    assert log.resource_id == "menu_456"
    assert log.payload == {"restaurant_name": "Le Bistrot"}
    assert log.ip_address == "192.168.1.1"
    assert log.created_at is not None


@pytest.mark.asyncio
async def test_query_logs_filters_by_actor_id(db_session: AsyncSession):
    """Test that query_logs can filter by actor_id."""
    # Create logs for different actors
    await log_action(db=db_session, actor_type="user", actor_id="user_1", action="test.action")
    await log_action(db=db_session, actor_type="user", actor_id="user_2", action="test.action")
    await log_action(db=db_session, actor_type="user", actor_id="user_1", action="test.action")

    # Query logs for user_1
    logs = await query_logs(db=db_session, actor_id="user_1")

    assert len(logs) == 2
    assert all(log.actor_id == "user_1" for log in logs)


@pytest.mark.asyncio
async def test_query_logs_filters_by_resource_type(db_session: AsyncSession):
    """Test that query_logs can filter by resource_type."""
    await log_action(db=db_session, actor_type="system", action="test", resource_type="menu")
    await log_action(db=db_session, actor_type="system", action="test", resource_type="payment")
    await log_action(db=db_session, actor_type="system", action="test", resource_type="menu")

    # Query logs for menu resources
    logs = await query_logs(db=db_session, resource_type="menu")

    assert len(logs) == 2
    assert all(log.resource_type == "menu" for log in logs)


@pytest.mark.asyncio
async def test_query_logs_ordered_by_created_at_desc(db_session: AsyncSession):
    """Test that query_logs returns results ordered by created_at DESC."""
    log1 = await log_action(db=db_session, actor_type="system", action="first")
    log2 = await log_action(db=db_session, actor_type="system", action="second")
    log3 = await log_action(db=db_session, actor_type="system", action="third")

    logs = await query_logs(db=db_session)

    # Should be ordered newest first
    assert logs[0].id == log3.id
    assert logs[1].id == log2.id
    assert logs[2].id == log1.id


@pytest.mark.asyncio
async def test_query_logs_respects_limit(db_session: AsyncSession):
    """Test that query_logs respects the limit parameter."""
    # Create 5 logs
    for i in range(5):
        await log_action(db=db_session, actor_type="system", action=f"test_{i}")

    # Query with limit=3
    logs = await query_logs(db=db_session, limit=3)

    assert len(logs) == 3


@pytest.mark.asyncio
async def test_query_logs_respects_offset(db_session: AsyncSession):
    """Test that query_logs respects the offset parameter."""
    # Create 5 logs
    for i in range(5):
        await log_action(db=db_session, actor_type="system", action=f"test_{i}")

    # Query with offset=2
    logs = await query_logs(db=db_session, offset=2)

    # Should get logs 3, 4, 5 (newest first, so test_4, test_3, test_2)
    assert len(logs) == 3


@pytest.mark.asyncio
async def test_get_log_by_id(db_session: AsyncSession):
    """Test that get_log_by_id retrieves the correct log."""
    log = await log_action(
        db=db_session,
        actor_type="user",
        action="test.action",
        payload={"key": "value"},
    )

    retrieved = await get_log_by_id(db=db_session, log_id=log.id)

    assert retrieved is not None
    assert retrieved.id == log.id
    assert retrieved.action == "test.action"
    assert retrieved.payload == {"key": "value"}


@pytest.mark.asyncio
async def test_get_log_by_id_returns_none_if_not_found(db_session: AsyncSession):
    """Test that get_log_by_id returns None for non-existent IDs."""
    retrieved = await get_log_by_id(db=db_session, log_id=99999)
    assert retrieved is None


@pytest.mark.asyncio
async def test_count_logs(db_session: AsyncSession):
    """Test that count_logs returns the correct count."""
    # Create 3 logs for user_1 and 2 logs for user_2
    for _ in range(3):
        await log_action(db=db_session, actor_type="user", actor_id="user_1", action="test")
    for _ in range(2):
        await log_action(db=db_session, actor_type="user", actor_id="user_2", action="test")

    # Count all logs
    total = await count_logs(db=db_session)
    assert total == 5

    # Count logs for user_1
    count_user_1 = await count_logs(db=db_session, actor_id="user_1")
    assert count_user_1 == 3


@pytest.mark.asyncio
async def test_log_menu_action_convenience_helper(db_session: AsyncSession):
    """Test the log_menu_action convenience helper."""
    log = await log_menu_action(
        db=db_session,
        action="create",
        menu_id="menu_123",
        actor_id="user_456",
        payload={"name": "Test Menu"},
        ip_address="127.0.0.1",
    )

    assert log.action == "menu.create"
    assert log.resource_type == "menu"
    assert log.resource_id == "menu_123"
    assert log.actor_type == "user"
    assert log.actor_id == "user_456"


@pytest.mark.asyncio
async def test_log_payment_action_convenience_helper(db_session: AsyncSession):
    """Test the log_payment_action convenience helper."""
    log = await log_payment_action(
        db=db_session,
        action="success",
        payment_id="pi_123",
        payload={"amount": 2500, "currency": "eur"},
    )

    assert log.action == "payment.success"
    assert log.resource_type == "payment"
    assert log.resource_id == "pi_123"
    assert log.actor_type == "system"
    assert log.payload["amount"] == 2500
