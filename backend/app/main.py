import asyncio
import logging
import logging.config
import uuid
from contextlib import asynccontextmanager
from time import monotonic

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from app.routers import menu, public, dashboard
from app.routers.auth import router as auth_router
from app.routers.menu import router_v1 as menu_router_v1
from app.routers.tables import router as tables_router
from app.routers.restaurants import router as restaurants_router
from app.routers.payments import router as payments_router
from app.routers.health import router as health_router
from app.routers.orders import router as orders_router
from app.routers.orders_ws import router as orders_ws_router
from app.routers.waiter_ws import router as waiter_ws_router
from app.routers.kds import router as kds_router, kds_redis_subscriber
from app.routers.analytics import router as analytics_router
from app.routers.admin import router as admin_router
from app.routers.subscriptions import router as subscriptions_router
from app.routers.staff import router as staff_router
from app.routers.reservations import router as reservations_router
from app.services.file_service import ensure_dirs
from app.config import (
    CLERK_WEBHOOK_SECRET, CORS_ORIGINS, FRONTEND_URL, IS_PRODUCTION,
    KDS_SECRET_TOKEN, SENTRY_DSN, STORAGE_DIR,
)
from app.core import redis as redis_core
from app.routers.public import limiter as chat_limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded


# ---------------------------------------------------------------------------
# Structured JSON logging
# ---------------------------------------------------------------------------

logging.config.dictConfig({
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "json": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "json",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": "INFO",
    },
})

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if IS_PRODUCTION:
        if KDS_SECRET_TOKEN == "kds-dev-token-change-in-production":
            logger.warning("SECURITY: KDS_SECRET_TOKEN is using the default dev value in production!")
        if not CLERK_WEBHOOK_SECRET:
            logger.warning("SECURITY: CLERK_WEBHOOK_SECRET is not set — webhook signatures will not be verified!")

    await redis_core.init_redis()

    # Start KDS Redis pub/sub subscriber (best-effort — no-op if Redis is down)
    kds_task: asyncio.Task | None = None
    try:
        redis_core.get_client()  # raises RuntimeError if Redis is unavailable
        kds_task = asyncio.create_task(kds_redis_subscriber(), name="kds_redis_subscriber")
    except RuntimeError:
        logger.warning("Redis unavailable — KDS subscriber not started")

    yield

    if kds_task and not kds_task.done():
        kds_task.cancel()
        try:
            await kds_task
        except asyncio.CancelledError:
            pass

    await redis_core.close_redis()


if SENTRY_DSN:
    import sentry_sdk
    sentry_sdk.init(dsn=SENTRY_DSN, traces_sample_rate=0.1)

ensure_dirs()

app = FastAPI(
    title="EASY.Q",
    description="AI-powered restaurant ordering & menu platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = chat_limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")


# ---------------------------------------------------------------------------
# Request ID + slow query middleware
# ---------------------------------------------------------------------------

@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if IS_PRODUCTION:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


@app.middleware("http")
async def add_request_id_and_log(request: Request, call_next):
    """Add X-Request-ID header and log slow requests (> 500ms)."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start = monotonic()

    response = await call_next(request)

    elapsed_ms = (monotonic() - start) * 1000
    response.headers["X-Request-ID"] = request_id

    if elapsed_ms > 500:
        logger.warning(
            "Slow request: %s %s took %.0fms [%s]",
            request.method,
            request.url.path,
            elapsed_ms,
            request_id,
        )

    return response


app.include_router(menu.router)
app.include_router(menu_router_v1)
app.include_router(tables_router)
app.include_router(restaurants_router)
app.include_router(public.router)
app.include_router(dashboard.router)
app.include_router(payments_router)
app.include_router(health_router)
app.include_router(orders_router)
app.include_router(orders_ws_router)
app.include_router(waiter_ws_router)
app.include_router(kds_router)
app.include_router(analytics_router)
app.include_router(admin_router)
app.include_router(subscriptions_router)
app.include_router(staff_router)
app.include_router(reservations_router)
app.include_router(auth_router)


@app.get("/")
async def root():
    return {"status": "EASY.Q API Running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/menu/{slug}")
async def redirect_to_frontend(slug: str):
    """Redirect QR code scans to frontend"""
    return RedirectResponse(url=f"{FRONTEND_URL}/menu/{slug}")
