import json
import logging
from typing import Generator
from google import genai
from google.genai import types
from app.config import GOOGLE_API_KEY

logger = logging.getLogger(__name__)

MODEL = "gemini-2.5-flash"

# ---------------------------------------------------------------------------
# place_order function declaration for Gemini function calling
# ---------------------------------------------------------------------------

PLACE_ORDER_TOOL = types.Tool(
    function_declarations=[
        types.FunctionDeclaration(
            name="place_order",
            description=(
                "Submit a food/drink order to the kitchen. "
                "Call this when the customer confirms they want to order specific items."
            ),
            parameters=types.Schema(
                type="OBJECT",
                properties={
                    "items": types.Schema(
                        type="ARRAY",
                        description="List of items being ordered",
                        items=types.Schema(
                            type="OBJECT",
                            properties={
                                "name": types.Schema(
                                    type="STRING",
                                    description="Exact dish name from the menu",
                                ),
                                "quantity": types.Schema(
                                    type="INTEGER",
                                    description="Number of portions",
                                ),
                                "notes": types.Schema(
                                    type="STRING",
                                    description="Special instructions (e.g. sans oignons)",
                                ),
                            },
                            required=["name", "quantity"],
                        ),
                    ),
                },
                required=["items"],
            ),
        )
    ]
)

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
- Take food orders when customers are ready to order
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
- When a customer confirms they want to order (e.g. "je voudrais commander", "I'll have", "order"), use the place_order function

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


def chat_about_menu_with_order(
    menu_data: dict,
    lang: str,
    messages: list[dict],
) -> tuple[str, dict | None]:
    """Non-streaming chat with place_order function calling support.

    Returns:
        (answer_text, order_items) where order_items is None if no order was placed,
        or a dict like {"items": [{"name": ..., "quantity": ..., "notes": ...}]}
        when Gemini calls place_order.
    """
    client = genai.Client(api_key=GOOGLE_API_KEY)
    _, all_contents = build_chat_contents(menu_data, lang, messages)

    try:
        response = client.models.generate_content(
            model=MODEL,
            contents=all_contents,
            config=types.GenerateContentConfig(tools=[PLACE_ORDER_TOOL]),
        )
    except Exception as e:
        logger.warning("Function calling failed, falling back to plain chat: %s", e)
        return chat_about_menu(menu_data, lang, messages), None

    # Check if Gemini wants to call place_order
    candidate = response.candidates[0] if response.candidates else None
    if not candidate:
        return response.text or "", None

    for part in candidate.content.parts:
        if hasattr(part, "function_call") and part.function_call:
            fc = part.function_call
            if fc.name == "place_order":
                order_data = dict(fc.args) if fc.args else {}
                # Build a confirmation message by sending function_response back
                items = order_data.get("items", [])
                item_names = ", ".join(
                    f"{i.get('quantity', 1)}× {i.get('name', '')}" for i in items
                )
                confirmation_msgs = {
                    "fr": f"Votre commande a bien été envoyée en cuisine : {item_names}. Elle sera prête dans quelques instants !",
                    "en": f"Your order has been sent to the kitchen: {item_names}. It will be ready shortly!",
                    "es": f"Tu pedido ha sido enviado a la cocina: {item_names}. ¡Estará listo en breve!",
                }
                confirmation = confirmation_msgs.get(lang, confirmation_msgs["en"])
                return confirmation, order_data

    # No function call — return plain text
    return response.text or "", None


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
