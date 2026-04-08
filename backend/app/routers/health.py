"""Health check endpoint — verifies DB, Redis, and R2 connectivity."""

import logging
from fastapi import APIRouter, status
from sqlalchemy import text

from app.db import engine
from app.core import redis as redis_core
from app.core.storage import storage_configured, _get_session, _client_kwargs, R2_BUCKET_NAME

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["health"])


@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    """
    Comprehensive health check endpoint.

    Checks:
    - Database connectivity (PostgreSQL/SQLite)
    - Redis connectivity
    - R2 storage configuration and connectivity

    Returns:
    - 200 OK if all services are healthy
    - 503 Service Unavailable if any service fails
    """
    health_status = {
        "status": "healthy",
        "checks": {
            "database": {"status": "unknown"},
            "redis": {"status": "unknown"},
            "storage": {"status": "unknown"},
        }
    }

    all_healthy = True

    # Check database connectivity
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        health_status["checks"]["database"]["status"] = "healthy"
        logger.debug("Health check: database OK")
    except Exception as e:
        health_status["checks"]["database"]["status"] = "unhealthy"
        health_status["checks"]["database"]["error"] = str(e)
        all_healthy = False
        logger.error(f"Health check: database FAILED - {e}")

    # Check Redis connectivity
    try:
        redis_client = redis_core.get_client()
        await redis_client.ping()
        health_status["checks"]["redis"]["status"] = "healthy"
        logger.debug("Health check: Redis OK")
    except Exception as e:
        health_status["checks"]["redis"]["status"] = "unhealthy"
        health_status["checks"]["redis"]["error"] = str(e)
        all_healthy = False
        logger.error(f"Health check: Redis FAILED - {e}")

    # Check R2 storage connectivity
    try:
        if not storage_configured():
            health_status["checks"]["storage"]["status"] = "not_configured"
            health_status["checks"]["storage"]["message"] = "R2 credentials not configured"
            logger.debug("Health check: R2 not configured (skipping)")
        else:
            # Test R2 connectivity by listing bucket
            session = _get_session()
            async with session.client("s3", **_client_kwargs()) as client:
                await client.head_bucket(Bucket=R2_BUCKET_NAME)
            health_status["checks"]["storage"]["status"] = "healthy"
            logger.debug("Health check: R2 OK")
    except Exception as e:
        health_status["checks"]["storage"]["status"] = "unhealthy"
        health_status["checks"]["storage"]["error"] = str(e)
        all_healthy = False
        logger.error(f"Health check: R2 FAILED - {e}")

    # Set overall status
    if not all_healthy:
        health_status["status"] = "degraded"
        return health_status

    return health_status
