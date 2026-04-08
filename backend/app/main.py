from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
from app.db import engine, Base
from app.routers import menu, public, dashboard
from app.routers.menu import router_v1 as menu_router_v1
from app.routers.tables import router as tables_router
from app.routers.restaurants import router as restaurants_router
from app.routers.payments import router as payments_router
from app.routers.health import router as health_router
from app.services.file_service import ensure_dirs
from app.config import STORAGE_DIR, CORS_ORIGINS, FRONTEND_URL
from app.core import redis as redis_core


@asynccontextmanager
async def lifespan(app: FastAPI):
    await redis_core.init_redis()
    yield
    await redis_core.close_redis()


ensure_dirs()
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="ServeurAI",
    description="Restaurant Menu AI Assistant",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=STORAGE_DIR), name="storage")

app.include_router(menu.router)
app.include_router(menu_router_v1)
app.include_router(tables_router)
app.include_router(restaurants_router)
app.include_router(public.router)
app.include_router(dashboard.router)
app.include_router(payments_router)
app.include_router(health_router)


@app.get("/")
async def root():
    return {"status": "ServeurAI API Running", "version": "1.0.0"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.get("/menu/{slug}")
async def redirect_to_frontend(slug: str):
    """Redirect QR code scans to frontend"""
    return RedirectResponse(url=f"{FRONTEND_URL}/menu/{slug}")
