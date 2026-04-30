"""
Unit tests for app/services/chat_service.py

Tests the service layer directly (no HTTP layer) with mocked Gemini client:
  - _extract_menu_context   — pure function, no mock needed
  - build_chat_contents     — pure function, no mock needed
  - chat_about_menu         — mocked genai.Client
  - chat_about_menu_with_order — mocked with + without function calling
  - chat_about_menu_stream  — mocked generator
"""

import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Sample menu data fixture
# ---------------------------------------------------------------------------

MENU_DATA = {
    "restaurant_name": "Le Bistrot Test",
    "sections": [
        {
            "title": "Entrées",
            "items": [
                {
                    "name": "Soupe à l'oignon",
                    "price": 8.5,
                    "allergens": ["gluten", "lactose"],
                    "tags": ["vegetarian"],
                },
                {
                    "name": "Carpaccio",
                    "price": 12.0,
                    "allergens": [],
                    "tags": [],
                },
            ],
        },
        {
            "title": "Vins",
            "items": [],
        },
    ],
    "wines": [
        {"name": "Bordeaux Rouge", "price": 35.0, "pairing_tags": ["meat"]},
    ],
}

EMPTY_MENU = {"sections": [], "wines": []}


# ===========================================================================
# _extract_menu_context
# ===========================================================================

class TestExtractMenuContext:

    def setup_method(self):
        from app.services.chat_service import _extract_menu_context
        self.fn = _extract_menu_context

    def test_empty_menu_returns_empty_string(self):
        result = self.fn(EMPTY_MENU)
        assert result == ""

    def test_extracts_allergens(self):
        result = self.fn(MENU_DATA)
        assert "gluten" in result
        assert "lactose" in result

    def test_extracts_dietary_tags(self):
        result = self.fn(MENU_DATA)
        assert "vegetarian" in result

    def test_no_duplicate_allergens(self):
        menu = {
            "sections": [
                {
                    "title": "A",
                    "items": [
                        {"name": "X", "allergens": ["gluten"], "tags": []},
                        {"name": "Y", "allergens": ["gluten"], "tags": []},
                    ],
                }
            ]
        }
        result = self.fn(menu)
        assert result.count("gluten") == 1

    def test_ignores_unknown_tags(self):
        menu = {
            "sections": [
                {
                    "title": "A",
                    "items": [
                        {"name": "X", "allergens": [], "tags": ["spicy", "house-special"]},
                    ],
                }
            ]
        }
        result = self.fn(menu)
        assert "spicy" not in result
        assert "house-special" not in result

    def test_handles_missing_allergens_key(self):
        menu = {
            "sections": [
                {"title": "A", "items": [{"name": "X", "tags": []}]},
            ]
        }
        result = self.fn(menu)
        assert result == ""  # no allergens, no dietary tags


# ===========================================================================
# build_chat_contents
# ===========================================================================

class TestBuildChatContents:

    def setup_method(self):
        from app.services.chat_service import build_chat_contents
        self.fn = build_chat_contents

    def test_returns_tuple_of_system_prompt_and_contents(self):
        system_prompt, contents = self.fn(MENU_DATA, "en", [])
        assert isinstance(system_prompt, str)
        assert isinstance(contents, list)

    def test_system_prompt_contains_language(self):
        system_prompt, _ = self.fn(MENU_DATA, "fr", [])
        assert "French" in system_prompt

    def test_system_prompt_contains_menu_json(self):
        system_prompt, _ = self.fn(MENU_DATA, "en", [])
        assert "Le Bistrot Test" in system_prompt

    def test_contents_starts_with_user_role(self):
        _, contents = self.fn(MENU_DATA, "en", [])
        assert contents[0]["role"] == "user"

    def test_history_messages_appended(self):
        messages = [
            {"role": "user", "content": "What is good?"},
            {"role": "assistant", "content": "The steak!"},
        ]
        _, contents = self.fn(MENU_DATA, "en", messages)
        # system prompt (1) + 2 history messages = 3 total
        assert len(contents) == 3

    def test_assistant_role_converted_to_model(self):
        messages = [
            {"role": "assistant", "content": "Hello!"},
        ]
        _, contents = self.fn(MENU_DATA, "en", messages)
        history_entry = contents[-1]
        assert history_entry["role"] == "model"

    def test_only_last_10_messages_used(self):
        messages = [{"role": "user", "content": f"msg {i}"} for i in range(15)]
        _, contents = self.fn(MENU_DATA, "en", messages)
        # system prompt (1) + 10 history messages = 11
        assert len(contents) == 11

    def test_unknown_roles_excluded(self):
        messages = [
            {"role": "system", "content": "ignore me"},
            {"role": "user", "content": "real message"},
        ]
        _, contents = self.fn(MENU_DATA, "en", messages)
        roles = [c["role"] for c in contents]
        assert "system" not in roles

    def test_spanish_language_name(self):
        system_prompt, _ = self.fn(MENU_DATA, "es", [])
        assert "Spanish" in system_prompt

    def test_unknown_lang_defaults_to_english(self):
        system_prompt, _ = self.fn(MENU_DATA, "de", [])
        assert "English" in system_prompt


# ===========================================================================
# chat_about_menu — mocked genai.Client
# ===========================================================================

class TestChatAboutMenu:

    def _make_mock_client(self, text: str = "Bonjour !"):
        mock_response = MagicMock()
        mock_response.text = text

        mock_models = MagicMock()
        mock_models.generate_content.return_value = mock_response

        mock_client = MagicMock()
        mock_client.models = mock_models
        return mock_client

    def test_returns_text_from_gemini(self):
        from app.services.chat_service import chat_about_menu

        mock_client = self._make_mock_client("Here is your answer.")

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            result = chat_about_menu(MENU_DATA, "en", [{"role": "user", "content": "What's good?"}])

        assert result == "Here is your answer."

    def test_returns_empty_string_when_text_is_none(self):
        from app.services.chat_service import chat_about_menu

        mock_client = self._make_mock_client(None)

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            result = chat_about_menu(MENU_DATA, "fr", [])

        assert result == ""

    def test_passes_correct_model(self):
        from app.services.chat_service import chat_about_menu, MODEL

        mock_client = self._make_mock_client("ok")

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            chat_about_menu(MENU_DATA, "en", [])

        call_kwargs = mock_client.models.generate_content.call_args
        assert call_kwargs.kwargs["model"] == MODEL or call_kwargs.args[0] == MODEL or MODEL in str(call_kwargs)


# ===========================================================================
# chat_about_menu_with_order — mocked with function calling
# ===========================================================================

class TestChatAboutMenuWithOrder:

    def _make_plain_response(self, text: str = "Great choice!"):
        """Response with no function call."""
        part = MagicMock()
        part.function_call = None
        part.text = text

        candidate = MagicMock()
        candidate.content.parts = [part]

        response = MagicMock()
        response.text = text
        response.candidates = [candidate]
        return response

    def _make_order_response(self, items: list):
        """Response where Gemini calls place_order."""
        fc = MagicMock()
        fc.name = "place_order"
        fc.args = {"items": items}

        part = MagicMock()
        part.function_call = fc

        candidate = MagicMock()
        candidate.content.parts = [part]

        response = MagicMock()
        response.text = None
        response.candidates = [candidate]
        return response

    def test_returns_text_and_none_when_no_order(self):
        from app.services.chat_service import chat_about_menu_with_order

        mock_response = self._make_plain_response("Here is my recommendation.")

        mock_models = MagicMock()
        mock_models.generate_content.return_value = mock_response
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            text, order_data = chat_about_menu_with_order(MENU_DATA, "en", [])

        assert text == "Here is my recommendation."
        assert order_data is None

    def test_returns_confirmation_and_order_when_function_called(self):
        from app.services.chat_service import chat_about_menu_with_order

        items = [{"name": "Steak", "quantity": 1}]
        mock_response = self._make_order_response(items)

        mock_models = MagicMock()
        mock_models.generate_content.return_value = mock_response
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            text, order_data = chat_about_menu_with_order(MENU_DATA, "en", [])

        assert "Steak" in text
        assert order_data is not None
        assert order_data["items"] == items

    def test_french_confirmation_message(self):
        from app.services.chat_service import chat_about_menu_with_order

        items = [{"name": "Soupe", "quantity": 2}]
        mock_response = self._make_order_response(items)

        mock_models = MagicMock()
        mock_models.generate_content.return_value = mock_response
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            text, _ = chat_about_menu_with_order(MENU_DATA, "fr", [])

        assert "cuisine" in text.lower() or "commande" in text.lower()

    def test_falls_back_to_plain_chat_on_exception(self):
        from app.services.chat_service import chat_about_menu_with_order

        plain_response = MagicMock()
        plain_response.text = "Fallback answer"

        mock_models = MagicMock()
        mock_models.generate_content.side_effect = [
            Exception("function_calling_not_supported"),
            plain_response,  # second call (fallback)
        ]
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            text, order_data = chat_about_menu_with_order(MENU_DATA, "en", [])

        assert text == "Fallback answer"
        assert order_data is None

    def test_handles_empty_candidates(self):
        from app.services.chat_service import chat_about_menu_with_order

        response = MagicMock()
        response.text = "plain text"
        response.candidates = []

        mock_models = MagicMock()
        mock_models.generate_content.return_value = response
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            text, order_data = chat_about_menu_with_order(MENU_DATA, "en", [])

        assert text == "plain text"
        assert order_data is None


# ===========================================================================
# chat_about_menu_stream — mocked generator
# ===========================================================================

class TestChatAboutMenuStream:

    def test_yields_text_chunks(self):
        from app.services.chat_service import chat_about_menu_stream

        chunk1 = MagicMock()
        chunk1.text = "Hello "
        chunk2 = MagicMock()
        chunk2.text = "world!"
        chunk3 = MagicMock()
        chunk3.text = None  # Should be skipped

        mock_models = MagicMock()
        mock_models.generate_content_stream.return_value = iter([chunk1, chunk2, chunk3])
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            chunks = list(chat_about_menu_stream(MENU_DATA, "en", []))

        assert chunks == ["Hello ", "world!"]  # None chunk skipped

    def test_empty_stream_yields_nothing(self):
        from app.services.chat_service import chat_about_menu_stream

        mock_models = MagicMock()
        mock_models.generate_content_stream.return_value = iter([])
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            chunks = list(chat_about_menu_stream(MENU_DATA, "en", []))

        assert chunks == []

    def test_returns_generator(self):
        from app.services.chat_service import chat_about_menu_stream
        from types import GeneratorType

        mock_models = MagicMock()
        mock_models.generate_content_stream.return_value = iter([])
        mock_client = MagicMock()
        mock_client.models = mock_models

        with patch("app.services.chat_service.genai.Client", return_value=mock_client):
            result = chat_about_menu_stream(MENU_DATA, "en", [])

        assert hasattr(result, "__iter__")
