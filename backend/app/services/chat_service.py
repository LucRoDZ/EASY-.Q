import json
from typing import Generator
from google import genai
from app.config import GOOGLE_API_KEY

MODEL = "gemini-2.5-flash"

LANG_NAMES = {"en": "English", "fr": "French", "es": "Spanish"}


def _extract_menu_context(menu_data: dict) -> str:
    """Extract allergen and dietary context from menu data for the system prompt."""
    allergens_present: set = set()
    dietary_tags_present: set = set()

    for section in menu_data.get("sections", []):
        for item in section.get("items", []):
            allergens_present.update(item.get("allergens", []))
            dietary_tags_present.update(
                t for t in item.get("tags", [])
                if t in {"vegetarian", "vegan", "végétarien", "végétalien", "halal", "bio", "gluten-free"}
            )

    lines = []
    if allergens_present:
        lines.append(f"Allergens present in the menu: {', '.join(sorted(allergens_present))}")
    if dietary_tags_present:
        lines.append(f"Dietary options available: {', '.join(sorted(dietary_tags_present))}")

    return "\n".join(lines)


def build_chat_contents(
    menu_data: dict, lang: str, messages: list[dict]
) -> tuple[str, list]:
    """Build the system prompt and conversation history for Gemini."""
    lang_name = LANG_NAMES.get(lang, "English")
    menu_context = _extract_menu_context(menu_data)

    system_prompt = f"""You are a friendly and knowledgeable restaurant waiter/sommelier.

IMPORTANT: Respond ONLY in {lang_name}.

Your role:
- Help customers choose dishes based on their preferences
- Recommend wines that pair well with their choices
- Answer questions about ingredients, allergens, and dietary restrictions
- Be warm, helpful, and concise

Dietary & allergen context:
{menu_context if menu_context else "No specific dietary/allergen information pre-extracted — refer to menu data below."}

Rules:
- ONLY recommend dishes and wines that exist in the provided menu data
- If a customer asks for something not on the menu, suggest similar alternatives from the menu
- For wine pairing, match wine pairing_tags with dish tags
- Keep responses short and conversational (2-3 sentences max)
- If asked for recommendations, ask about preferences first (meat/fish/vegetarian, allergens, budget)
- When mentioning dish names, wrap them in **bold** markdown
- When a dish has allergens, always mention the key ones proactively
- For dietary questions (vegetarian, vegan, gluten-free), list all qualifying dishes

Menu data (your source of truth):
{json.dumps(menu_data, ensure_ascii=False)}
"""

    history = []
    for m in messages[-10:]:
        role = m.get("role")
        content = m.get("content", "")
        if role == "assistant":
            role = "model"
        if role in ("user", "model"):
            history.append({"role": role, "parts": [{"text": content}]})

    all_contents = [{"role": "user", "parts": [{"text": system_prompt}]}]
    all_contents.extend(history)

    return system_prompt, all_contents


def chat_about_menu(menu_data: dict, lang: str, messages: list[dict]) -> str:
    """Non-streaming chat (for fallback)."""
    client = genai.Client(api_key=GOOGLE_API_KEY)
    _, all_contents = build_chat_contents(menu_data, lang, messages)

    response = client.models.generate_content(
        model=MODEL,
        contents=all_contents,
    )
    return response.text or ""


def chat_about_menu_stream(
    menu_data: dict, lang: str, messages: list[dict]
) -> Generator[str, None, None]:
    """Streaming chat that yields text chunks."""
    client = genai.Client(api_key=GOOGLE_API_KEY)
    _, all_contents = build_chat_contents(menu_data, lang, messages)

    response = client.models.generate_content_stream(
        model=MODEL,
        contents=all_contents,
    )

    for chunk in response:
        if chunk.text:
            yield chunk.text
