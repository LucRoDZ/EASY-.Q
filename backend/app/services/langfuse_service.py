from __future__ import annotations

from typing import Any
from app.config import LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST

try:
    from langfuse import Langfuse
except Exception:  # pragma: no cover - optional dependency
    Langfuse = None


class LangfuseService:
    def __init__(self):
        self._client = None
        if not Langfuse or not LANGFUSE_PUBLIC_KEY or not LANGFUSE_SECRET_KEY:
            return

        self._client = Langfuse(
            public_key=LANGFUSE_PUBLIC_KEY,
            secret_key=LANGFUSE_SECRET_KEY,
            host=LANGFUSE_HOST,
        )

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def trace_chat(
        self,
        *,
        menu_slug: str,
        restaurant_name: str,
        session_id: str,
        lang: str,
        messages: list[dict[str, Any]],
        answer: str,
        model: str,
    ) -> dict[str, str] | None:
        if not self._client:
            return None

        user_input = ""
        if messages:
            user_input = messages[-1].get("content", "")

        try:
            with self._client.start_as_current_generation(
                name="menu-chat",
                model=model,
                input=user_input,
                output=answer,
                metadata={
                    "menu_slug": menu_slug,
                    "restaurant_name": restaurant_name,
                    "session_id": session_id,
                    "language": lang,
                    "history_length": len(messages),
                },
                trace_context={
                    "name": "easyq-customer-chat",
                    "session_id": session_id,
                    "user_id": session_id,
                    "tags": ["easyq", "chatbot", menu_slug],
                },
            ):
                trace_id = self._client.get_current_trace_id()

            self._client.flush()

            if trace_id:
                return {
                    "trace_id": trace_id,
                    "trace_url": self._client.get_trace_url(trace_id=trace_id),
                }
        except Exception as e:
            print(f"Langfuse tracing failed: {e}")

        return None


langfuse_service = LangfuseService()
