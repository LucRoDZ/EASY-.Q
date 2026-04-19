"""
Tests for chat / public menu endpoints:
  GET  /api/public/menus/{slug}         — public menu view
  POST /api/public/menus/{slug}/chat    — chatbot (non-streaming)
  POST /api/public/menus/{slug}/chat/stream — SSE streaming chat
  GET  /api/public/menus/{slug}/conversation — load chat history
  DELETE /api/public/menus/{slug}/conversation — clear chat history
"""

import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db import Base, get_db
from app.models import Menu, Conversation


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(scope="function")
def test_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestingSessionLocal
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def client(test_db, monkeypatch):
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "init_redis", AsyncMock())
    monkeypatch.setattr(redis_core, "close_redis", AsyncMock())

    with TestClient(app) as c:
        yield c


@pytest.fixture
def menu(test_db):
    """Seed a ready Menu for tests."""
    menu_data = {
        "restaurant_name": "Le Bistrot",
        "sections": [
            {
                "title": "Entrées",
                "items": [
                    {"name": "Soupe à l'oignon", "price": 8.5, "allergens": ["gluten"], "tags": ["vegetarian"]},
                    {"name": "Salade verte", "price": 6.0, "allergens": [], "tags": ["vegan"]},
                ],
            },
            {
                "title": "Plats",
                "items": [
                    {"name": "Steak frites", "price": 22.0, "allergens": [], "tags": []},
                ],
            },
        ],
        "wines": [{"name": "Bordeaux Rouge", "price": 24.0}],
    }
    session = test_db()
    m = Menu(
        restaurant_name="Le Bistrot",
        slug="le-bistrot",
        pdf_path="menu.pdf",
        languages="fr,en,es",
        menu_data=json.dumps(menu_data),
        status="ready",
        publish_status="published",
    )
    session.add(m)
    session.commit()
    menu_id = m.id
    session.close()
    return {"slug": "le-bistrot", "id": menu_id}


# ---------------------------------------------------------------------------
# GET /api/public/menus/{slug} — public menu view
# ---------------------------------------------------------------------------


def test_get_public_menu_returns_sections(client, menu):
    """Public menu endpoint returns restaurant name and sections."""
    resp = client.get(f"/api/public/menus/{menu['slug']}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["restaurant_name"] == "Le Bistrot"
    assert len(body["sections"]) == 2


def test_get_public_menu_unknown_slug_returns_404(client):
    """Unknown slug → 404."""
    resp = client.get("/api/public/menus/nonexistent-restaurant")
    assert resp.status_code == 404


def test_get_public_menu_contains_items(client, menu):
    """Each section contains items with name, price, allergens."""
    resp = client.get(f"/api/public/menus/{menu['slug']}")
    body = resp.json()
    first_section = body["sections"][0]
    assert "items" in first_section
    item = first_section["items"][0]
    assert "name" in item
    assert "price" in item


# ---------------------------------------------------------------------------
# POST /api/public/menus/{slug}/chat — non-streaming chat
# ---------------------------------------------------------------------------


def _mock_gemini_answer(answer_text: str = "Je recommande le steak frites !"):
    """Patch chat_about_menu_with_order to return a fixed answer without order."""
    return patch(
        "app.routers.public.chat_about_menu_with_order",
        return_value=(answer_text, None),
    )


def test_chat_returns_answer(client, menu, monkeypatch):
    """POST /chat returns an AI answer."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())

    # Patch langfuse service
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    with _mock_gemini_answer("Voici mes recommandations !"):
        resp = client.post(
            f"/api/public/menus/{menu['slug']}/chat",
            json={
                "messages": [{"role": "user", "content": "Que recommandez-vous ?"}],
                "lang": "fr",
                "session_id": "sess_test_1",
            },
        )

    assert resp.status_code == 200
    body = resp.json()
    assert "answer" in body
    assert len(body["answer"]) > 0


def test_chat_unknown_menu_returns_404(client):
    """POST /chat for nonexistent menu → 404."""
    resp = client.post(
        "/api/public/menus/nonexistent/chat",
        json={"messages": [{"role": "user", "content": "Hello"}], "lang": "fr"},
    )
    assert resp.status_code == 404


def test_chat_without_session_id_still_works(client, menu, monkeypatch):
    """Chat without session_id skips Redis persistence but returns answer."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    with _mock_gemini_answer("Bonjour !"):
        resp = client.post(
            f"/api/public/menus/{menu['slug']}/chat",
            json={"messages": [{"role": "user", "content": "Bonjour"}], "lang": "fr"},
        )

    assert resp.status_code == 200
    assert "answer" in resp.json()


def test_chat_uses_redis_session_history(client, menu, monkeypatch):
    """When Redis has history, it's loaded as conversation context."""
    import app.core.redis as redis_core

    redis_history = [
        {"role": "user", "content": "Y a-t-il des plats végétariens ?"},
        {"role": "assistant", "content": "Oui, la salade verte est végane."},
    ]
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=redis_history))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    with _mock_gemini_answer("D'accord, suite à notre discussion..."):
        resp = client.post(
            f"/api/public/menus/{menu['slug']}/chat",
            json={
                "messages": [{"role": "user", "content": "Et le vin ?"}],
                "lang": "fr",
                "session_id": "sess_with_history",
            },
        )

    assert resp.status_code == 200
    # Redis get_session was called with the session_id
    redis_core.get_session.assert_called_once_with("sess_with_history")


def test_chat_persists_messages_to_db(client, menu, test_db, monkeypatch):
    """After a chat with session_id, conversation is saved in DB."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    with _mock_gemini_answer("Bien sûr !"):
        resp = client.post(
            f"/api/public/menus/{menu['slug']}/chat",
            json={
                "messages": [{"role": "user", "content": "Quels sont les desserts ?"}],
                "lang": "fr",
                "session_id": "sess_persist",
            },
        )

    assert resp.status_code == 200

    session = test_db()
    conv = session.query(Conversation).filter(Conversation.session_id == "sess_persist").first()
    session.close()

    assert conv is not None
    messages = json.loads(conv.messages)
    assert any(m["role"] == "user" for m in messages)
    assert any(m["role"] == "assistant" for m in messages)


# ---------------------------------------------------------------------------
# GET /api/public/menus/{slug}/conversation
# ---------------------------------------------------------------------------


def test_get_conversation_returns_messages(client, menu, test_db, monkeypatch):
    """GET /conversation returns stored messages for a session."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    # First send a chat message to seed the conversation
    with _mock_gemini_answer("La soupe est délicieuse !"):
        client.post(
            f"/api/public/menus/{menu['slug']}/chat",
            json={
                "messages": [{"role": "user", "content": "C'est quoi la soupe ?"}],
                "lang": "fr",
                "session_id": "sess_history",
            },
        )

    resp = client.get(
        f"/api/public/menus/{menu['slug']}/conversation?session_id=sess_history"
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "messages" in body
    assert len(body["messages"]) >= 2  # user + assistant


def test_get_conversation_unknown_menu_returns_404(client):
    """GET /conversation for unknown menu → 404."""
    resp = client.get("/api/public/menus/ghost/conversation?session_id=sess_x")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# DELETE /api/public/menus/{slug}/conversation
# ---------------------------------------------------------------------------


def test_delete_conversation_clears_history(client, menu, test_db, monkeypatch):
    """DELETE /conversation clears the stored messages."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    # Seed conversation
    with _mock_gemini_answer("..."):
        client.post(
            f"/api/public/menus/{menu['slug']}/chat",
            json={
                "messages": [{"role": "user", "content": "Test"}],
                "lang": "fr",
                "session_id": "sess_to_clear",
            },
        )

    # Clear it
    resp = client.delete(
        f"/api/public/menus/{menu['slug']}/conversation?session_id=sess_to_clear"
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "cleared"

    # Verify messages are cleared in DB (row stays, messages = "[]")
    session = test_db()
    conv = session.query(Conversation).filter(Conversation.session_id == "sess_to_clear").first()
    session.close()
    assert conv is not None
    assert json.loads(conv.messages) == []


# ---------------------------------------------------------------------------
# POST /api/public/menus/{slug}/chat/stream — SSE streaming
# ---------------------------------------------------------------------------


def test_chat_stream_returns_sse_content_type(client, menu, monkeypatch):
    """Streaming chat returns text/event-stream content type."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr(redis_core, "publish_order_event", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    # Mock the streaming generator
    def mock_stream(*args, **kwargs):
        yield "Bonjour "
        yield "cher client !"

    with patch("app.routers.public.chat_about_menu_stream", side_effect=mock_stream):
        resp = client.post(
            f"/api/public/menus/{menu['slug']}/chat/stream",
            json={
                "messages": [{"role": "user", "content": "Bonjour"}],
                "lang": "fr",
                "session_id": "sess_stream",
            },
        )

    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers["content-type"]


def test_chat_stream_unknown_menu_returns_404(client):
    """Streaming chat for nonexistent menu → 404."""
    resp = client.post(
        "/api/public/menus/nonexistent/chat/stream",
        json={"messages": [{"role": "user", "content": "Hi"}], "lang": "en"},
    )
    assert resp.status_code == 404


def test_chat_stream_contains_done_marker(client, menu, monkeypatch):
    """Streamed response contains [DONE] marker at the end."""
    import app.core.redis as redis_core
    monkeypatch.setattr(redis_core, "get_session", AsyncMock(return_value=[]))
    monkeypatch.setattr(redis_core, "set_session", AsyncMock())
    monkeypatch.setattr("app.routers.public.langfuse_service.trace_chat", MagicMock(return_value=None))

    def mock_stream(*args, **kwargs):
        yield "chunk1"
        yield "chunk2"

    with patch("app.routers.public.chat_about_menu_stream", side_effect=mock_stream):
        resp = client.post(
            f"/api/public/menus/{menu['slug']}/chat/stream",
            json={"messages": [{"role": "user", "content": "Test"}], "lang": "fr"},
        )

    content = resp.text
    assert "[DONE]" in content
