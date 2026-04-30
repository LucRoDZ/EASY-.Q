from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from typing import Optional

import fitz  # PyMuPDF
from google import genai
from google.genai import types

from app.config import GOOGLE_API_KEY

MODEL = "gemini-2.5-flash-lite"

# ──────────────────────────────────────────────────────────────────────────────
# Internal data structures
# ──────────────────────────────────────────────────────────────────────────────

@dataclass
class _ImageBlock:
    data: bytes
    ext: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


@dataclass
class _TextBlock:
    text: str
    page: int
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2


# ──────────────────────────────────────────────────────────────────────────────
# PDF extraction (PyMuPDF — free, no API tokens)
# ──────────────────────────────────────────────────────────────────────────────

_MIN_IMAGE_WIDTH = 60
_MIN_IMAGE_HEIGHT = 60
_MAX_PAGE_COVERAGE = 0.50


def _extract_text_and_images(pdf_path: str) -> tuple[str, list[_ImageBlock], list[_TextBlock]]:
    doc = fitz.open(pdf_path)
    full_text_parts: list[str] = []
    images: list[_ImageBlock] = []
    text_blocks: list[_TextBlock] = []

    for page_num, page in enumerate(doc):
        page_rect = page.rect
        page_area = page_rect.width * page_rect.height

        blocks = page.get_text("blocks")
        page_lines: list[str] = []
        for b in blocks:
            if b[6] != 0:
                continue
            text = b[4].strip()
            if not text:
                continue
            page_lines.append(text)
            text_blocks.append(_TextBlock(
                text=text, page=page_num,
                x0=b[0], y0=b[1], x1=b[2], y1=b[3],
            ))
        if page_lines:
            full_text_parts.append(f"--- Page {page_num + 1} ---\n" + "\n".join(page_lines))

        for img_info in page.get_images(full=True):
            xref = img_info[0]
            try:
                base_image = doc.extract_image(xref)
            except Exception:
                continue

            w, h = base_image["width"], base_image["height"]
            if w < _MIN_IMAGE_WIDTH or h < _MIN_IMAGE_HEIGHT:
                continue

            img_rects = page.get_image_rects(xref)
            if not img_rects:
                continue
            rect = img_rects[0]

            if (rect.width * rect.height) / page_area > _MAX_PAGE_COVERAGE:
                continue

            ext = base_image["ext"]
            if ext not in ("png", "jpeg", "jpg", "webp"):
                ext = "png"
            ext = ext.replace("jpg", "jpeg")

            images.append(_ImageBlock(
                data=base_image["image"], ext=ext, page=page_num,
                x0=rect.x0, y0=rect.y0, x1=rect.x1, y1=rect.y1,
            ))

    doc.close()
    return "\n\n".join(full_text_parts), images, text_blocks


# ──────────────────────────────────────────────────────────────────────────────
# Scanned PDF fallback (pytesseract)
# ──────────────────────────────────────────────────────────────────────────────

def _extract_text_tesseract(pdf_path: str) -> str:
    try:
        import pytesseract
        from pdf2image import convert_from_path
    except ImportError as e:
        raise RuntimeError(
            "pytesseract / pdf2image not installed for scanned PDF fallback"
        ) from e

    imgs = convert_from_path(pdf_path, dpi=200)
    parts: list[str] = []
    for i, img in enumerate(imgs):
        text = pytesseract.image_to_string(img, lang="fra+eng")
        parts.append(f"--- Page {i + 1} ---\n{text.strip()}")
    return "\n\n".join(parts)


# ──────────────────────────────────────────────────────────────────────────────
# Spatial image → item matching
# ──────────────────────────────────────────────────────────────────────────────

_MAX_VERTICAL_DISTANCE = 120


def _match_images_to_items(
    items: list[dict],
    images: list[_ImageBlock],
    text_blocks: list[_TextBlock],
) -> list[dict]:
    if not images:
        for item in items:
            item["_matched_image"] = None
        return items

    def _norm(s: str) -> str:
        return re.sub(r"\s+", " ", (s or "").lower().strip())

    image_to_nearest_text: dict[int, str] = {}
    for img_idx, img in enumerate(images):
        best_dist = float("inf")
        best_text = ""
        for tb in text_blocks:
            if tb.page != img.page:
                continue
            dist = abs(tb.cy - img.cy)
            if dist < best_dist and dist <= _MAX_VERTICAL_DISTANCE:
                best_dist = dist
                best_text = tb.text
        image_to_nearest_text[img_idx] = _norm(best_text)

    used_images: set[int] = set()
    for item in items:
        name = _norm(item.get("name", ""))
        best_img_idx: Optional[int] = None
        best_score = 0

        for img_idx, near_text in image_to_nearest_text.items():
            if img_idx in used_images:
                continue
            score = sum(
                1 for w in name.split()
                if w in near_text and len(w) > 3
            )
            if score > best_score:
                best_score = score
                best_img_idx = img_idx

        if best_img_idx is not None and best_score >= 1:
            item["_matched_image"] = images[best_img_idx]
            used_images.add(best_img_idx)
        else:
            item["_matched_image"] = None

    return items


# ──────────────────────────────────────────────────────────────────────────────
# Image upload to R2
# ──────────────────────────────────────────────────────────────────────────────

def _upload_item_images(items: list[dict], slug: str) -> list[dict]:
    try:
        from app.services.file_service import FileService
        file_svc = FileService()
    except Exception:
        for item in items:
            item.pop("_matched_image", None)
        return items

    for item in items:
        img_block: Optional[_ImageBlock] = item.pop("_matched_image", None)
        if img_block is None:
            item["image_url"] = None
            continue
        try:
            filename = f"menu-items/{slug}/{uuid.uuid4().hex}.{img_block.ext}"
            url = file_svc.upload_bytes(
                data=img_block.data,
                key=filename,
                content_type=f"image/{img_block.ext}",
            )
            item["image_url"] = url
        except Exception:
            item["image_url"] = None

    return items


# ──────────────────────────────────────────────────────────────────────────────
# LLM (text-only)
# ──────────────────────────────────────────────────────────────────────────────

def _client():
    return genai.Client(api_key=GOOGLE_API_KEY)


def _extract_json(text: str) -> dict:
    text = (text or "").strip()
    if not text:
        raise ValueError("Empty response from LLM")

    if "```" in text:
        text = re.sub(r"```json\s*", "", text)
        text = re.sub(r"```\s*", "", text)
        text = text.strip()

    start = text.find("{")
    if start == -1:
        raise ValueError("No JSON object found in response")

    depth, end = 0, start
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
        json_text = re.sub(r",\s*}", "}", json_text)
        json_text = re.sub(r",\s*\]", "]", json_text)
        return json.loads(json_text)


EXTRACTION_PROMPT = """
Extract menu data from the text below. Return ONLY valid JSON:

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
- Allergens (ONLY these values): gluten, lactose, oeufs, poisson, arachides, soja,
  fruits_coque, celeri, moutarde, sesame, sulfites, lupin, mollusques, crustaces
- Tags: meat, fish, vegetarian, vegan, spicy, dessert, starter, cheese, halal,
  bio, maison, signature, nouveau
- Wine types: red, white, rose, sparkling
- Short descriptions (max 60 chars) — null if absent
- Return ONLY valid JSON, no extra text

Menu text:
"""


def _structure_with_llm(text: str) -> dict:
    client = _client()
    config = types.GenerateContentConfig(
        max_output_tokens=65536,
        temperature=0.1,
    )
    response = client.models.generate_content(
        model=MODEL,
        contents=[{"role": "user", "parts": [{"text": EXTRACTION_PROMPT + text}]}],
        config=config,
    )
    return _extract_json(response.text or "")


# ──────────────────────────────────────────────────────────────────────────────
# Public API
# ──────────────────────────────────────────────────────────────────────────────

def extract_menu_from_pdf(pdf_path: str, restaurant_slug: str = "unknown") -> dict:
    raw_text, images, text_blocks = _extract_text_and_images(pdf_path)

    if len(raw_text.strip()) < 50:
        raw_text = _extract_text_tesseract(pdf_path)
        images = []
        text_blocks = []

    result = _structure_with_llm(raw_text)

    all_items: list[dict] = []
    for section in result.get("sections", []):
        all_items.extend(section.get("items", []))

    if images and all_items:
        all_items = _match_images_to_items(all_items, images, text_blocks)
        all_items = _upload_item_images(all_items, restaurant_slug)

    return result


def extract_menu_from_images(image_paths: list[str]) -> dict:
    try:
        import pytesseract
        from PIL import Image
    except ImportError as e:
        raise RuntimeError("pip install pytesseract Pillow") from e

    parts: list[str] = []
    for path in image_paths:
        img = Image.open(path)
        text = pytesseract.image_to_string(img, lang="fra+eng")
        parts.append(text.strip())

    return _structure_with_llm("\n\n".join(parts))


def validate_ocr_result(raw: dict) -> dict:
    from app.schemas import OCRMenuData

    try:
        validated = OCRMenuData.model_validate(raw)
        result = validated.model_dump()
        for key, value in raw.items():
            if key not in result:
                result[key] = value
        return result
    except Exception:
        return {
            "restaurant_name": raw.get("restaurant_name", "Unknown"),
            "currency": raw.get("currency", "EUR"),
            "sections": raw.get("sections", []),
            "wines": raw.get("wines", []),
        }


def translate_menu(menu_data: dict, target_lang: str) -> dict:
    lang_map = {"en": "English", "fr": "French", "es": "Spanish"}
    lang_name = lang_map.get(target_lang)
    if not lang_name:
        return menu_data

    client = _client()
    config = types.GenerateContentConfig(max_output_tokens=4096, temperature=0.1)

    translated_sections = []
    for section in menu_data.get("sections", []):
        prompt = (
            f"Translate to {lang_name}. Return ONLY valid JSON:\n"
            f"{json.dumps(section, ensure_ascii=False)}\n\n"
            "Keep prices, tags unchanged. Only translate title, names, descriptions."
        )
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[{"role": "user", "parts": [{"text": prompt}]}],
                config=config,
            )
            translated_sections.append(_extract_json(response.text or ""))
        except Exception:
            translated_sections.append(section)

    wines = menu_data.get("wines", [])
    translated_wines = wines

    if wines:
        prompt = (
            f"Translate to {lang_name}. Return ONLY valid JSON array:\n"
            f"{json.dumps(wines, ensure_ascii=False)}\n\n"
            "Keep prices, types, pairing_tags unchanged. Only translate names."
        )
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=[{"role": "user", "parts": [{"text": prompt}]}],
                config=config,
            )
            text = response.text or ""
            start, end = text.find("["), text.rfind("]") + 1
            if start >= 0 and end > start:
                translated_wines = json.loads(text[start:end])
        except Exception:
            pass

    return {"sections": translated_sections, "wines": translated_wines}
