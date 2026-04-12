"""
Redis async client — connection pooling, TTL helpers, session & cache utilities.

TTL constants (seconds):
  MENU_CACHE_TTL    : 5 min   — public menu by slug+lang
  OCR_CACHE_TTL     : 24 h    — Gemini OCR result keyed by PDF sha256
  SESSION_TTL       : 2 h     — chatbot session messages
  RATE_LIMIT_TTL    : 1 min   — sliding-window counters
"""

import json
import logging
from typing import Any

import redis.asyncio as aioredis
from redis.asyncio import ConnectionPool

from app.config import REDIS_URL

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# TTL constants
# ---------------------------------------------------------------------------
MENU_CACHE_TTL = 5 * 60           # 5 minutes
OCR_CACHE_TTL = 24 * 60 * 60     # 24 hours
TRANSLATION_CACHE_TTL = 7 * 24 * 60 * 60  # 7 days
SESSION_TTL = 2 * 60 * 60         # 2 hours
RATE_LIMIT_TTL = 60               # 1 minute

# ---------------------------------------------------------------------------
# Global pool & client — initialised in lifespan
# ---------------------------------------------------------------------------
_pool: ConnectionPool | None = None
_client: aioredis.Redis | None = None


def get_client() -> aioredis.Redis:
    """Return the shared async Redis client. Raises if not initialised."""
    if _client is None:
        raise RuntimeError("Redis client not initialised — call init_redis() first")
    return _client


async def init_redis() -> None:
    """Create the connection pool and ping Redis to verify connectivity.
    If Redis is unavailable, logs a warning and continues in degraded mode."""
    global _pool, _client
    _pool = ConnectionPool.from_url(
        REDIS_URL,
        max_connections=20,
        decode_responses=True,
    )
    _client = aioredis.Redis(connection_pool=_pool)
    try:
        await _client.ping()
        logger.info("Redis connected: %s", REDIS_URL)
    except Exception as exc:
        logger.warning("Redis unavailable (%s) — running in degraded mode (no cache/sessions)", exc)
        _client = None
        if _pool:
            await _pool.aclose()
        _pool = None


async def close_redis() -> None:
    """Gracefully close the connection pool."""
    global _pool, _client
    if _client:
        await _client.aclose()
        _client = None
    if _pool:
        await _pool.aclose()
        _pool = None
    logger.info("Redis connection closed")


# ---------------------------------------------------------------------------
# Generic cache helpers
# ---------------------------------------------------------------------------

async def cache_get(key: str) -> Any | None:
    """Return decoded JSON value or None if key missing."""
    client = get_client()
    raw = await client.get(key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return raw


async def cache_set(key: str, value: Any, ttl: int) -> None:
    """Serialise value to JSON and store with TTL (seconds)."""
    client = get_client()
    await client.setex(key, ttl, json.dumps(value, ensure_ascii=False))


async def cache_delete(key: str) -> None:
    """Delete a cache key."""
    client = get_client()
    await client.delete(key)


async def cache_delete_pattern(pattern: str) -> int:
    """Delete all keys matching a glob pattern. Returns count deleted."""
    client = get_client()
    keys = await client.keys(pattern)
    if not keys:
        return 0
    return await client.delete(*keys)


# ---------------------------------------------------------------------------
# Menu cache (5 min, keyed by slug + lang)
# ---------------------------------------------------------------------------

def menu_key(slug: str, lang: str = "fr") -> str:
    return f"menu:{slug}:{lang}"


async def get_menu_cache(slug: str, lang: str = "fr") -> Any | None:
    return await cache_get(menu_key(slug, lang))


async def set_menu_cache(slug: str, data: Any, lang: str = "fr") -> None:
    await cache_set(menu_key(slug, lang), data, MENU_CACHE_TTL)


async def invalidate_menu_cache(slug: str) -> None:
    """Delete all language variants for a menu slug."""
    await cache_delete_pattern(f"menu:{slug}:*")


# ---------------------------------------------------------------------------
# OCR cache (24 h, keyed by PDF sha256)
# ---------------------------------------------------------------------------

def ocr_key(sha256: str) -> str:
    return f"ocr:{sha256}"


async def get_ocr_cache(sha256: str) -> Any | None:
    return await cache_get(ocr_key(sha256))


async def set_ocr_cache(sha256: str, data: Any) -> None:
    await cache_set(ocr_key(sha256), data, OCR_CACHE_TTL)


# ---------------------------------------------------------------------------
# Translation cache (7 days, keyed by content hash + lang)
# ---------------------------------------------------------------------------

def translation_key(content_hash: str, lang: str) -> str:
    return f"translation:{content_hash}:{lang}"


async def get_translation_cache(content_hash: str, lang: str) -> Any | None:
    return await cache_get(translation_key(content_hash, lang))


async def set_translation_cache(content_hash: str, lang: str, data: Any) -> None:
    await cache_set(translation_key(content_hash, lang), data, TRANSLATION_CACHE_TTL)


# ---------------------------------------------------------------------------
# Chat session helpers (2 h TTL, stored as JSON list of messages)
# ---------------------------------------------------------------------------

def session_key(session_id: str) -> str:
    return f"session:{session_id}"


async def get_session(session_id: str) -> list[dict] | None:
    """Return list of {role, content, timestamp} dicts or None."""
    return await cache_get(session_key(session_id))


async def set_session(session_id: str, messages: list[dict]) -> None:
    """Persist chat history, resetting TTL to 2 h."""
    await cache_set(session_key(session_id), messages, SESSION_TTL)


async def append_session_message(session_id: str, message: dict) -> list[dict]:
    """Append a message to the session and refresh TTL. Creates session if absent."""
    messages = await get_session(session_id) or []
    messages.append(message)
    await set_session(session_id, messages)
    return messages


async def delete_session(session_id: str) -> None:
    await cache_delete(session_key(session_id))


# ---------------------------------------------------------------------------
# Pub/Sub helpers (KDS real-time orders)
# ---------------------------------------------------------------------------

def kds_channel(restaurant_id: str) -> str:
    return f"kds:{restaurant_id}"


async def publish_order_event(restaurant_id: str, event: dict) -> None:
    """Publish a KDS order event to the restaurant's pub/sub channel."""
    client = get_client()
    await client.publish(kds_channel(restaurant_id), json.dumps(event, ensure_ascii=False))


def get_pubsub() -> aioredis.client.PubSub:
    """Return a new PubSub instance from the shared client."""
    return get_client().pubsub()


# ---------------------------------------------------------------------------
# Waiter calls (hash: waiter:calls:{slug}, field=call_id, value=JSON)
# ---------------------------------------------------------------------------

WAITER_CALLS_TTL = 4 * 60 * 60  # 4 hours


def waiter_calls_key(slug: str) -> str:
    return f"waiter:calls:{slug}"


def waiter_channel(slug: str) -> str:
    return f"waiter:{slug}"


async def push_waiter_call(slug: str, call: dict) -> None:
    """Store a waiter call in the restaurant's pending-calls hash, history list, and notify."""
    client = get_client()
    key = waiter_calls_key(slug)
    call.setdefault("status", "pending")
    call_json = json.dumps(call, ensure_ascii=False)
    await client.hset(key, call["id"], call_json)
    await client.expire(key, WAITER_CALLS_TTL)
    # Also store in history list (capped at 200, 7-day TTL)
    hist_key = waiter_call_history_key(slug)
    await client.lpush(hist_key, call_json)
    await client.ltrim(hist_key, 0, 199)
    await client.expire(hist_key, WAITER_CALL_HISTORY_TTL)
    await client.publish(waiter_channel(slug), call_json)


async def get_waiter_calls(slug: str) -> list[dict]:
    """Return all pending waiter calls for a slug, newest first."""
    client = get_client()
    raw = await client.hgetall(waiter_calls_key(slug))
    calls = []
    for v in raw.values():
        try:
            calls.append(json.loads(v))
        except Exception:
            pass
    return sorted(calls, key=lambda c: c.get("timestamp", ""), reverse=True)


async def update_waiter_call_status(slug: str, call_id: str, status: str) -> dict | None:
    """Update the status of a waiter call in the pending hash. Returns updated call or None."""
    client = get_client()
    key = waiter_calls_key(slug)
    raw = await client.hget(key, call_id)
    if raw is None:
        return None
    call = json.loads(raw)
    call["status"] = status
    await client.hset(key, call_id, json.dumps(call, ensure_ascii=False))
    return call


async def dismiss_waiter_call(slug: str, call_id: str) -> None:
    """Remove a waiter call from the pending hash (resolved/dismissed)."""
    client = get_client()
    await client.hdel(waiter_calls_key(slug), call_id)


# ---------------------------------------------------------------------------
# Waiter call history (list per slug, capped at 200, 7-day TTL)
# ---------------------------------------------------------------------------

WAITER_CALL_HISTORY_TTL = 7 * 24 * 60 * 60  # 7 days


def waiter_call_history_key(slug: str) -> str:
    return f"waiter:history:{slug}"


async def get_call_history(slug: str, table_number: str | None = None) -> list[dict]:
    """Return call history for a slug, optionally filtered by table_number."""
    client = get_client()
    raw = await client.lrange(waiter_call_history_key(slug), 0, -1)
    calls = []
    for v in raw:
        try:
            call = json.loads(v)
            if table_number is None or call.get("table_number") == table_number:
                calls.append(call)
        except Exception:
            pass
    return calls
