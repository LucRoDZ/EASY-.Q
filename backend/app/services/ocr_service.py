import json
import re
import base64
from pdf2image import convert_from_path
from google import genai
from google.genai import types
from app.config import GOOGLE_API_KEY

MODEL = "gemini-2.5-flash"


def _client():
    return genai.Client(api_key=GOOGLE_API_KEY)


def _extract_json(text: str) -> dict:
    """Extract JSON from Gemini response, handling common issues"""
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty response from Gemini")

    if "```" in text:
        text = re.sub(r"```json\s*", "", text)
        text = re.sub(r"```\s*", "", text)
        text = text.strip()

    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found")

    depth = 0
    end = start
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    json_text = text[start:end]

    try:
        return json.loads(json_text)
    except json.JSONDecodeError:
        # Try to fix trailing comma issues
        json_text = re.sub(r",\s*}", "}", json_text)
        json_text = re.sub(r",\s*\]", "]", json_text)
        return json.loads(json_text)


EXTRACTION_PROMPT = """
Extract menu data from this document. Return ONLY valid JSON:

{
  "restaurant_name": "Name",
  "currency": "EUR",
  "sections": [
    {
      "title": "Section Name",
      "items": [
        {
          "name": "Dish Name",
          "description": "Short description",
          "price": 12.50,
          "allergens": ["gluten", "lactose"],
          "tags": ["meat"]
        }
      ]
    }
  ],
  "wines": [
    {"name": "Wine Name", "type": "red", "price": 35.00, "pairing_tags": ["meat"]}
  ]
}

Rules:
- Extract ALL dishes and wines
- Prices as float (e.g. 12.50, not "12,50€") — null if absent
- Allergens (use ONLY these values): gluten, lactose, oeufs, poisson, arachides, soja, fruits_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques, crustaces — empty array [] if none
- Tags: meat, fish, vegetarian, vegan, spicy, dessert, starter, cheese, halal, bio, maison, signature, nouveau
- Wine types: red, white, rose, sparkling
- Short descriptions (max 60 chars) — null if absent
- Return ONLY valid JSON, no extra text
"""


def extract_menu_from_pdf(pdf_path: str) -> dict:
    """Extract menu from PDF, trying image conversion if direct PDF fails"""
    client = _client()

    try:
        with open(pdf_path, "rb") as f:
            pdf_bytes = f.read()

        pdf_base64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

        config = types.GenerateContentConfig(
            max_output_tokens=16384,
            temperature=0.1,
        )

        response = client.models.generate_content(
            model=MODEL,
            contents=[
                {
                    "role": "user",
                    "parts": [
                        {"text": EXTRACTION_PROMPT},
                        {
                            "inline_data": {
                                "mime_type": "application/pdf",
                                "data": pdf_base64,
                            }
                        },
                    ],
                }
            ],
            config=config,
        )
        return _extract_json(response.text or "")
    except Exception as e:
        print(f"Direct PDF failed ({e}), trying image conversion...")
        images = convert_from_path(pdf_path, dpi=150)

        parts = [{"text": EXTRACTION_PROMPT}]

        for img in images:
            import io

            img_bytes_io = io.BytesIO()
            img.save(img_bytes_io, format="PNG")
            img_bytes = img_bytes_io.getvalue()

            img_base64 = base64.standard_b64encode(img_bytes).decode("utf-8")
            parts.append(
                {"inline_data": {"mime_type": "image/png", "data": img_base64}}
            )

        config = types.GenerateContentConfig(
            max_output_tokens=16384,
            temperature=0.1,
        )

        response = client.models.generate_content(
            model=MODEL,
            contents=[{"role": "user", "parts": parts}],
            config=config,
        )
        return _extract_json(response.text or "")


def validate_ocr_result(raw: dict) -> dict:
    """Validate and normalise raw OCR output using Pydantic schemas.

    Invalid allergens/tags/wine types are stripped. Negative prices become null.
    Falls back gracefully: always returns a usable dict even if validation fails.
    """
    from app.schemas import OCRMenuData

    try:
        validated = OCRMenuData.model_validate(raw)
        result = validated.model_dump()
        # Preserve extra top-level keys (e.g. translations) from the raw dict
        for key, value in raw.items():
            if key not in result:
                result[key] = value
        return result
    except Exception:
        # Return minimal structure if Pydantic validation itself raises
        return {
            "restaurant_name": raw.get("restaurant_name", "Unknown"),
            "currency": raw.get("currency", "EUR"),
            "sections": raw.get("sections", []),
            "wines": raw.get("wines", []),
        }


def extract_menu_from_images(image_paths: list[str]) -> dict:
    client = _client()
    parts = [{"text": EXTRACTION_PROMPT}]

    for img_path in image_paths:
        with open(img_path, "rb") as f:
            img_bytes = f.read()
        ext = img_path.lower().split(".")[-1]
        mime = "image/png" if ext == "png" else "image/jpeg"
        img_base64 = base64.standard_b64encode(img_bytes).decode("utf-8")
        parts.append({"inline_data": {"mime_type": mime, "data": img_base64}})

    response = client.models.generate_content(
        model=MODEL,
        contents=[{"role": "user", "parts": parts}],
    )
    return _extract_json(response.text or "")


def translate_menu(menu_data: dict, target_lang: str) -> dict:
    """Translate menu sections and wines to target language - section by section to avoid token limits"""
    if target_lang == "en":
        lang_name = "English"
    elif target_lang == "fr":
        lang_name = "French"
    elif target_lang == "es":
        lang_name = "Spanish"
    else:
        return menu_data

    client = _client()

    config = types.GenerateContentConfig(
        max_output_tokens=4096,
        temperature=0.1,
    )

    translated_sections = []
    sections = menu_data.get("sections", [])

    for section in sections:
        prompt = f"""Translate to {lang_name}. Return ONLY valid JSON:
{json.dumps(section, ensure_ascii=False)}

Keep prices, tags unchanged. Only translate title, names, descriptions.
Return ONLY valid JSON, same structure."""

        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[{"role": "user", "parts": [{"text": prompt}]}],
                config=config,
            )
            translated_section = _extract_json(response.text or "")
            translated_sections.append(translated_section)
        except Exception:
            translated_sections.append(section)
    wines = menu_data.get("wines", [])
    translated_wines = wines

    if wines:
        prompt = f"""Translate to {lang_name}. Return ONLY valid JSON array:
{json.dumps(wines, ensure_ascii=False)}

Keep prices, types, pairing_tags unchanged. Only translate names.
Return ONLY valid JSON array."""

        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[{"role": "user", "parts": [{"text": prompt}]}],
                config=config,
            )
            text = response.text or ""
            start = text.find("[")
            end = text.rfind("]") + 1
            if start >= 0 and end > start:
                translated_wines = json.loads(text[start:end])
        except Exception:
            pass

    return {"sections": translated_sections, "wines": translated_wines}
