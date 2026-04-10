import asyncio
import hashlib
import json

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.core import redis as redis_core
from app.db import SessionLocal, get_db
from app.models import Menu
from app.schemas import (
    MenuCreateResponse,
    MenuDuplicateResponse,
    MenuEditorResponse,
    MenuPublishResponse,
    MenuSaveResponse,
    MenuStatusResponse,
    MenuUpdateBody,
    SaveTranslationBody,
    TranslateResponse,
    UploadMenuResponse,
)
from app.services.file_service import save_pdf, save_upload_file, is_valid_pdf, detect_mime_type
from app.services.menu_service import _slugify, create_menu
from app.services.ocr_service import extract_menu_from_pdf, extract_menu_from_images, translate_menu, validate_ocr_result

router = APIRouter(prefix="/api/menus", tags=["menus"])
router_v1 = APIRouter(prefix="/api/v1/menus", tags=["menus"])

MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB


# ---------------------------------------------------------------------------
# Background OCR task
# ---------------------------------------------------------------------------

_OCR_MAX_RETRIES = 3


async def _run_ocr_background(
    menu_id: int, file_path: str, sha256: str, restaurant_name: str, is_image: bool = False
) -> None:
    """Run OCR in a thread pool with up to 3 retries (exponential backoff), cache result in Redis, persist to DB."""
    loop = asyncio.get_event_loop()
    status = "error"
    ocr_error = None
    menu_data_json = "{}"

    for attempt in range(_OCR_MAX_RETRIES):
        try:
            if is_image:
                menu_data = await loop.run_in_executor(None, extract_menu_from_images, [file_path])
            else:
                menu_data = await loop.run_in_executor(None, extract_menu_from_pdf, file_path)

            # Validate and normalise OCR output
            menu_data = validate_ocr_result(menu_data)
            menu_data.setdefault("restaurant_name", restaurant_name)

            # Build translations (blocking Gemini calls run in executor)
            base_menu = {
                "sections": menu_data.get("sections", []),
                "wines": menu_data.get("wines", []),
            }
            translations: dict = {}
            for lang in ("en", "fr", "es"):
                try:
                    translated = await loop.run_in_executor(None, translate_menu, base_menu, lang)
                    translations[lang] = {
                        "sections": translated.get("sections", base_menu["sections"]),
                        "wines": translated.get("wines", base_menu["wines"]),
                    }
                except Exception:
                    translations[lang] = base_menu
            menu_data["translations"] = translations

            # Cache OCR result 24 h
            await redis_core.set_ocr_cache(sha256, menu_data)

            status = "ready"
            ocr_error = None
            menu_data_json = json.dumps(menu_data, ensure_ascii=False)
            break

        except Exception as exc:
            ocr_error = str(exc)[:450]
            if attempt < _OCR_MAX_RETRIES - 1:
                backoff_seconds = 2 ** attempt  # 1 s, 2 s, 4 s
                await asyncio.sleep(backoff_seconds)

    db: Session = SessionLocal()
    try:
        menu = db.query(Menu).filter(Menu.id == menu_id).first()
        if menu:
            menu.menu_data = menu_data_json
            menu.status = status
            menu.ocr_error = ocr_error
            db.commit()
    finally:
        db.close()


@router.post("", response_model=MenuCreateResponse)
async def upload_menu(
    restaurant_name: str = Form(...),
    languages: str = Form("en,fr,es"),
    pdf: UploadFile = File(...),
    db: Session = Depends(get_db)
):
    content = await pdf.read()
    
    if not content or len(content) < 100:
        raise HTTPException(status_code=400, detail="PDF file is empty or too small")
    
    if not is_valid_pdf(content):
        raise HTTPException(status_code=400, detail="Invalid PDF file")
    
    pdf_path = save_pdf(content, pdf.filename or "menu.pdf")
    
    menu, qr_url = create_menu(db, restaurant_name, pdf_path, languages)
    
    from app.config import BASE_URL
    public_url = f"{BASE_URL}/menu/{menu.slug}"
    
    return MenuCreateResponse(
        id=menu.id,
        slug=menu.slug,
        public_url=public_url,
        qr_url=qr_url
    )


# ---------------------------------------------------------------------------
# v1 endpoints
# ---------------------------------------------------------------------------

@router_v1.post("/upload", response_model=UploadMenuResponse, status_code=202)
async def upload_menu_v1(
    background_tasks: BackgroundTasks,
    restaurant_name: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
) -> UploadMenuResponse:
    """Upload a PDF or image menu. OCR runs asynchronously.

    Returns immediately with status "processing" (or "ready" on cache hit).
    Poll GET /api/v1/menus/{menu_id}/status for completion.
    """
    content = await file.read()

    if len(content) < 100:
        raise HTTPException(status_code=400, detail="File is empty or too small")
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large — max 20 MB")

    # Magic-bytes validation: PDF, JPEG, PNG, WebP
    is_pdf = content[:5] == b"%PDF-"
    is_jpeg = content[:3] == b"\xff\xd8\xff"
    is_png = content[:8] == b"\x89PNG\r\n\x1a\n"
    is_webp = content[8:12] == b"WEBP"
    if not (is_pdf or is_jpeg or is_png or is_webp):
        raise HTTPException(
            status_code=400,
            detail="Invalid file — PDF or image (JPEG/PNG/WebP) required",
        )

    sha256 = hashlib.sha256(content).hexdigest()
    filename = file.filename or "menu.pdf"
    file_path = save_upload_file(content, filename)
    mime_type = detect_mime_type(content, filename)
    is_image = mime_type.startswith("image/")
    slug = _slugify(restaurant_name)

    # Redis cache hit → skip OCR, go directly to ready
    cached_ocr = await redis_core.get_ocr_cache(sha256)
    if cached_ocr:
        cached_ocr.setdefault("restaurant_name", restaurant_name)
        status = "ready"
        menu_data_json = json.dumps(cached_ocr, ensure_ascii=False)
    else:
        status = "processing"
        menu_data_json = "{}"

    menu = Menu(
        restaurant_name=restaurant_name,
        slug=slug,
        pdf_path=file_path,
        languages="en,fr,es",
        menu_data=menu_data_json,
        status=status,
    )
    db.add(menu)
    db.commit()
    db.refresh(menu)

    if status == "processing":
        background_tasks.add_task(
            _run_ocr_background, menu.id, file_path, sha256, restaurant_name, is_image
        )

    return UploadMenuResponse(menu_id=menu.id, slug=menu.slug, status=menu.status)


@router_v1.get("/{menu_id}/status", response_model=MenuStatusResponse)
def get_menu_status(menu_id: int, db: Session = Depends(get_db)) -> MenuStatusResponse:
    """Poll OCR status for a menu uploaded via /api/v1/menus/upload."""
    menu = db.query(Menu).filter(Menu.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    menu_data: dict | None = None
    if menu.status == "ready" and menu.menu_data and menu.menu_data != "{}":
        try:
            menu_data = json.loads(menu.menu_data)
        except Exception:
            pass

    return MenuStatusResponse(
        menu_id=menu.id,
        slug=menu.slug,
        status=menu.status,
        ocr_error=menu.ocr_error,
        menu_data=menu_data,
    )


@router_v1.get("/{menu_id}", response_model=MenuEditorResponse)
def get_menu_for_editor(menu_id: int, db: Session = Depends(get_db)) -> MenuEditorResponse:
    """Return full menu data for the editor (sections + wines)."""
    menu = db.query(Menu).filter(Menu.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    data: dict = {}
    if menu.menu_data:
        try:
            data = json.loads(menu.menu_data)
        except Exception:
            pass

    return MenuEditorResponse(
        menu_id=menu.id,
        slug=menu.slug,
        restaurant_name=menu.restaurant_name,
        status=menu.status,
        publish_status=menu.publish_status if menu.publish_status else "draft",
        sections=data.get("sections", []),
        wines=data.get("wines", []),
        languages=menu.languages,
    )


@router_v1.patch("/{menu_id}/translate", response_model=TranslateResponse)
async def translate_menu_endpoint(
    menu_id: int,
    lang: str = Query(..., description="Target language: en, fr, es"),
    db: Session = Depends(get_db),
) -> TranslateResponse:
    """Auto-translate menu sections + wines to target language via Gemini. Stores result in DB."""
    if lang not in ("en", "fr", "es"):
        raise HTTPException(status_code=400, detail="lang must be one of: en, fr, es")

    menu = db.query(Menu).filter(Menu.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    data: dict = {}
    if menu.menu_data:
        try:
            data = json.loads(menu.menu_data)
        except Exception:
            pass

    base_menu = {
        "sections": data.get("sections", []),
        "wines": data.get("wines", []),
    }

    loop = asyncio.get_event_loop()
    translated = await loop.run_in_executor(None, translate_menu, base_menu, lang)

    translations: dict = data.get("translations", {})
    translations[lang] = {
        "sections": translated.get("sections", base_menu["sections"]),
        "wines": translated.get("wines", base_menu["wines"]),
    }
    data["translations"] = translations
    menu.menu_data = json.dumps(data, ensure_ascii=False)

    # Ensure lang is recorded in the languages field
    langs = set(filter(None, menu.languages.split(","))) if menu.languages else set()
    langs.add(lang)
    langs.add("fr")
    menu.languages = ",".join(sorted(langs))

    db.commit()

    return TranslateResponse(
        menu_id=menu.id,
        lang=lang,
        sections=translations[lang]["sections"],
        wines=translations[lang]["wines"],
    )


@router_v1.patch("/{menu_id}/translations/{lang}", response_model=TranslateResponse)
async def save_translation(
    menu_id: int,
    lang: str,
    body: SaveTranslationBody,
    db: Session = Depends(get_db),
) -> TranslateResponse:
    """Persist manually-edited translation for a given language."""
    if lang not in ("en", "fr", "es"):
        raise HTTPException(status_code=400, detail="lang must be one of: en, fr, es")

    menu = db.query(Menu).filter(Menu.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    data: dict = {}
    if menu.menu_data:
        try:
            data = json.loads(menu.menu_data)
        except Exception:
            pass

    translations: dict = data.get("translations", {})
    translations[lang] = {"sections": body.sections, "wines": body.wines}
    data["translations"] = translations
    menu.menu_data = json.dumps(data, ensure_ascii=False)

    langs = set(filter(None, menu.languages.split(","))) if menu.languages else set()
    langs.add(lang)
    langs.add("fr")
    menu.languages = ",".join(sorted(langs))

    db.commit()
    await redis_core.invalidate_menu_cache(menu.slug)

    return TranslateResponse(
        menu_id=menu.id,
        lang=lang,
        sections=body.sections,
        wines=body.wines,
    )


@router_v1.patch("/{menu_id}", response_model=MenuSaveResponse)
async def update_menu(
    menu_id: int,
    body: MenuUpdateBody,
    db: Session = Depends(get_db),
) -> MenuSaveResponse:
    """Persist editor changes. Replaces sections/wines in menu_data and invalidates Redis cache."""
    menu = db.query(Menu).filter(Menu.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    data: dict = {}
    if menu.menu_data:
        try:
            data = json.loads(menu.menu_data)
        except Exception:
            pass

    if body.restaurant_name is not None:
        menu.restaurant_name = body.restaurant_name
        data["restaurant_name"] = body.restaurant_name

    if body.sections is not None:
        data["sections"] = [s.model_dump() for s in body.sections]

    if body.wines is not None:
        data["wines"] = body.wines

    menu.menu_data = json.dumps(data, ensure_ascii=False)
    db.commit()

    # Invalidate menu cache for all language variants
    await redis_core.invalidate_menu_cache(menu.slug)

    return MenuSaveResponse(menu_id=menu.id, slug=menu.slug)


@router_v1.patch("/{menu_id}/publish", response_model=MenuPublishResponse)
async def publish_menu(
    menu_id: int,
    publish_status: str = Query(..., description="draft or published"),
    db: Session = Depends(get_db),
) -> MenuPublishResponse:
    """Toggle the publish status of a menu (draft / published)."""
    if publish_status not in ("draft", "published"):
        raise HTTPException(status_code=400, detail="publish_status must be 'draft' or 'published'")

    menu = db.query(Menu).filter(Menu.id == menu_id).first()
    if not menu:
        raise HTTPException(status_code=404, detail="Menu not found")

    menu.publish_status = publish_status
    db.commit()

    # Invalidate public cache when publishing/unpublishing
    await redis_core.invalidate_menu_cache(menu.slug)

    return MenuPublishResponse(menu_id=menu.id, slug=menu.slug, publish_status=menu.publish_status)


@router_v1.post("/{menu_id}/duplicate", response_model=MenuDuplicateResponse, status_code=201)
def duplicate_menu(
    menu_id: int,
    db: Session = Depends(get_db),
) -> MenuDuplicateResponse:
    """Create a copy of a menu with a new slug. The duplicate starts as a draft."""
    source = db.query(Menu).filter(Menu.id == menu_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Menu not found")

    # Build a unique slug: append -copy, or -copy-2, -copy-3, etc.
    base_slug = f"{source.slug}-copy"
    candidate = base_slug
    counter = 2
    while db.query(Menu).filter(Menu.slug == candidate).first():
        candidate = f"{base_slug}-{counter}"
        counter += 1

    duplicate = Menu(
        restaurant_name=f"{source.restaurant_name} (copie)",
        slug=candidate,
        pdf_path=source.pdf_path,
        languages=source.languages,
        menu_data=source.menu_data,
        status=source.status,
        publish_status="draft",
        ocr_error=None,
    )
    db.add(duplicate)
    db.commit()
    db.refresh(duplicate)

    return MenuDuplicateResponse(menu_id=duplicate.id, slug=duplicate.slug)
