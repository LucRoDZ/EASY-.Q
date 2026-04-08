"""
Tests for /api/v1/health endpoint — verifies DB, Redis, and R2 health checks.
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
import fakeredis.aioredis as fakeredis

from app.main import app
from app.db import Base, get_db


# ---------------------------------------------------------------------------
# Test database fixture
# ---------------------------------------------------------------------------

@pytest.fixture(scope="function")
def test_db():
    """Create an in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield engine
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Test client fixture
# ---------------------------------------------------------------------------

@pytest.fixture
def client(test_db):
    """FastAPI test client with test database."""
    return TestClient(app)


# ---------------------------------------------------------------------------
# Fake Redis fixture
# ---------------------------------------------------------------------------

@pytest_asyncio.fixture
async def fake_redis(monkeypatch):
    """Patch Redis client with fakeredis."""
    import app.core.redis as redis_core
    client = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis_core, "_client", client)
    yield client
    await client.aclose()


# ---------------------------------------------------------------------------
# Health check tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_health_check_all_healthy(client, fake_redis, monkeypatch):
    """Test health check when all services are healthy."""
    # Mock R2 storage
    mock_storage_configured = MagicMock(return_value=True)
    mock_head_bucket = AsyncMock()

    with patch("app.routers.health.storage_configured", mock_storage_configured), \
         patch("app.routers.health._get_session") as mock_session:

        # Setup mock S3 client
        mock_client = AsyncMock()
        mock_client.head_bucket = mock_head_bucket
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        mock_session_instance = MagicMock()
        mock_session_instance.client = MagicMock(return_value=mock_client)
        mock_session.return_value = mock_session_instance

        response = client.get("/api/v1/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "healthy"
        assert data["checks"]["database"]["status"] == "healthy"
        assert data["checks"]["redis"]["status"] == "healthy"
        assert data["checks"]["storage"]["status"] == "healthy"


@pytest.mark.asyncio
async def test_health_check_database_unhealthy(client, fake_redis, monkeypatch):
    """Test health check when database is unavailable."""
    # Simulate database connection failure
    from app.routers.health import engine

    with patch.object(engine, "connect") as mock_connect:
        mock_connect.side_effect = Exception("Database connection failed")

        # Mock R2 as not configured to simplify test
        with patch("app.routers.health.storage_configured", return_value=False):
            response = client.get("/api/v1/health")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "degraded"
            assert data["checks"]["database"]["status"] == "unhealthy"
            assert "error" in data["checks"]["database"]


@pytest.mark.asyncio
async def test_health_check_redis_unhealthy(client, monkeypatch):
    """Test health check when Redis is unavailable."""
    import app.core.redis as redis_core

    # Mock Redis client that fails ping
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=Exception("Redis connection refused"))
    monkeypatch.setattr(redis_core, "_client", mock_redis)

    # Mock R2 as not configured to simplify test
    with patch("app.routers.health.storage_configured", return_value=False):
        response = client.get("/api/v1/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["checks"]["redis"]["status"] == "unhealthy"
        assert "error" in data["checks"]["redis"]


@pytest.mark.asyncio
async def test_health_check_storage_not_configured(client, fake_redis):
    """Test health check when R2 storage is not configured."""
    with patch("app.routers.health.storage_configured", return_value=False):
        response = client.get("/api/v1/health")

        assert response.status_code == 200
        data = response.json()
        assert data["checks"]["storage"]["status"] == "not_configured"
        assert "not configured" in data["checks"]["storage"]["message"].lower()


@pytest.mark.asyncio
async def test_health_check_storage_unhealthy(client, fake_redis, monkeypatch):
    """Test health check when R2 storage connection fails."""
    mock_storage_configured = MagicMock(return_value=True)

    with patch("app.routers.health.storage_configured", mock_storage_configured), \
         patch("app.routers.health._get_session") as mock_session:

        # Setup mock S3 client that fails
        mock_client = AsyncMock()
        mock_client.head_bucket = AsyncMock(side_effect=Exception("R2 connection failed"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        mock_session_instance = MagicMock()
        mock_session_instance.client = MagicMock(return_value=mock_client)
        mock_session.return_value = mock_session_instance

        response = client.get("/api/v1/health")

        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "degraded"
        assert data["checks"]["storage"]["status"] == "unhealthy"
        assert "error" in data["checks"]["storage"]


@pytest.mark.asyncio
async def test_health_check_multiple_services_down(client, monkeypatch):
    """Test health check when multiple services are down."""
    import app.core.redis as redis_core
    from app.routers.health import engine

    # Fail both database and Redis
    mock_redis = AsyncMock()
    mock_redis.ping = AsyncMock(side_effect=Exception("Redis down"))
    monkeypatch.setattr(redis_core, "_client", mock_redis)

    with patch.object(engine, "connect") as mock_connect:
        mock_connect.side_effect = Exception("Database down")

        # Mock R2 as not configured
        with patch("app.routers.health.storage_configured", return_value=False):
            response = client.get("/api/v1/health")

            assert response.status_code == 200
            data = response.json()
            assert data["status"] == "degraded"
            assert data["checks"]["database"]["status"] == "unhealthy"
            assert data["checks"]["redis"]["status"] == "unhealthy"
