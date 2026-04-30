"""
Tests for backend/app/core/redis.py — uses fakeredis for no live-server dependency.
"""

import json
import pytest
import pytest_asyncio
import fakeredis.aioredis as fakeredis

import app.core.redis as redis_core


@pytest_asyncio.fixture(autouse=True)
async def fake_redis(monkeypatch):
    """Patch the module-level _client with a fakeredis instance."""
    client = fakeredis.FakeRedis(decode_responses=True)
    monkeypatch.setattr(redis_core, "_client", client)
    yield client
    await client.aclose()


# ---------------------------------------------------------------------------
# Generic cache
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cache_set_and_get():
    await redis_core.cache_set("test:key", {"hello": "world"}, ttl=60)
    result = await redis_core.cache_get("test:key")
    assert result == {"hello": "world"}


@pytest.mark.asyncio
async def test_cache_get_missing_returns_none():
    result = await redis_core.cache_get("nonexistent")
    assert result is None


@pytest.mark.asyncio
async def test_cache_delete():
    await redis_core.cache_set("del:key", 42, ttl=60)
    await redis_core.cache_delete("del:key")
    assert await redis_core.cache_get("del:key") is None


@pytest.mark.asyncio
async def test_cache_delete_pattern():
    await redis_core.cache_set("pat:a", 1, ttl=60)
    await redis_core.cache_set("pat:b", 2, ttl=60)
    await redis_core.cache_set("other:c", 3, ttl=60)
    deleted = await redis_core.cache_delete_pattern("pat:*")
    assert deleted == 2
    assert await redis_core.cache_get("other:c") == 3


# ---------------------------------------------------------------------------
# Menu cache
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_menu_cache_roundtrip():
    data = {"sections": [], "name": "Test Menu"}
    await redis_core.set_menu_cache("test-slug", data, lang="fr")
    result = await redis_core.get_menu_cache("test-slug", lang="fr")
    assert result == data


@pytest.mark.asyncio
async def test_invalidate_menu_cache_all_langs():
    await redis_core.set_menu_cache("bistro", {"x": 1}, lang="fr")
    await redis_core.set_menu_cache("bistro", {"x": 2}, lang="en")
    await redis_core.invalidate_menu_cache("bistro")
    assert await redis_core.get_menu_cache("bistro", lang="fr") is None
    assert await redis_core.get_menu_cache("bistro", lang="en") is None


# ---------------------------------------------------------------------------
# OCR cache
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ocr_cache_roundtrip():
    sha = "abc123def456"
    payload = {"items": [{"name": "Steak", "price": 25}]}
    await redis_core.set_ocr_cache(sha, payload)
    result = await redis_core.get_ocr_cache(sha)
    assert result == payload


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_session_set_and_get():
    msgs = [{"role": "user", "content": "Bonjour"}]
    await redis_core.set_session("sess-1", msgs)
    result = await redis_core.get_session("sess-1")
    assert result == msgs


@pytest.mark.asyncio
async def test_session_missing_returns_none():
    assert await redis_core.get_session("no-such-session") is None


@pytest.mark.asyncio
async def test_append_session_message():
    first = {"role": "user", "content": "Hi"}
    second = {"role": "assistant", "content": "Hello!"}
    await redis_core.set_session("sess-2", [first])
    messages = await redis_core.append_session_message("sess-2", second)
    assert messages == [first, second]


@pytest.mark.asyncio
async def test_append_creates_session_if_absent():
    msg = {"role": "user", "content": "first"}
    messages = await redis_core.append_session_message("new-sess", msg)
    assert messages == [msg]


@pytest.mark.asyncio
async def test_delete_session():
    await redis_core.set_session("sess-del", [{"role": "user", "content": "bye"}])
    await redis_core.delete_session("sess-del")
    assert await redis_core.get_session("sess-del") is None


# ---------------------------------------------------------------------------
# Key helpers
# ---------------------------------------------------------------------------

def test_menu_key():
    assert redis_core.menu_key("my-resto", "en") == "menu:my-resto:en"


def test_ocr_key():
    assert redis_core.ocr_key("deadbeef") == "ocr:deadbeef"


def test_session_key():
    assert redis_core.session_key("abc") == "session:abc"


def test_kds_channel():
    assert redis_core.kds_channel("resto-99") == "kds:resto-99"
