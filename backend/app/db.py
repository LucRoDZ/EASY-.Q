from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import DATABASE_URL

# Synchronous engine: strip async dialect suffix (e.g. postgresql+asyncpg → postgresql)
_sync_url = DATABASE_URL.replace("+asyncpg", "").replace("+aiosqlite", "")
connect_args = {"check_same_thread": False} if _sync_url.startswith("sqlite") else {}
engine = create_engine(_sync_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
