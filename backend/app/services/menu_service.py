import json
import secrets
import re
from sqlalchemy.orm import Session
from app.models import Menu
from app.services.ocr_service import extract_menu_from_pdf, translate_menu
from app.services.qr_service import generate_qr


def _slugify(name: str) -> str:
    s = (name or "menu").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    suffix = secrets.token_hex(3)
    return f"{s[:40]}-{suffix}" if s else f"menu-{suffix}"


def create_menu(
    db: Session, restaurant_name: str, pdf_path: str, languages: str = "en,fr,es"
) -> tuple[Menu, str]:
    menu_data = extract_menu_from_pdf(pdf_path)
    menu_data.setdefault("restaurant_name", restaurant_name)

    lang_list = [lng.strip() for lng in languages.split(",")]
    translations = {}

    base_menu = {
        "sections": menu_data.get("sections", []),
        "wines": menu_data.get("wines", []),
    }

    for lang in lang_list:
        try:
            translated = translate_menu(base_menu, lang)
            translations[lang] = {
                "sections": translated.get("sections", base_menu["sections"]),
                "wines": translated.get("wines", base_menu["wines"]),
            }
        except Exception as e:
            print(f"Translation to {lang} failed: {e}")
            translations[lang] = base_menu

    menu_data["translations"] = translations

    slug = _slugify(restaurant_name)

    menu = Menu(
        restaurant_name=restaurant_name,
        slug=slug,
        pdf_path=pdf_path,
        languages=languages,
        menu_data=json.dumps(menu_data, ensure_ascii=False),
    )
    db.add(menu)
    db.commit()
    db.refresh(menu)

    qr_url = generate_qr(slug)

    return menu, qr_url


def get_menu_by_slug(db: Session, slug: str) -> Menu | None:
    return db.query(Menu).filter(Menu.slug == slug).first()


def get_menu_data(menu: Menu, lang: str = "en") -> dict:
    data = json.loads(menu.menu_data)

    translations = data.get("translations", {})

    if lang in translations:
        sections = translations[lang].get("sections", data.get("sections", []))
        wines = translations[lang].get("wines", data.get("wines", []))
    else:
        sections = data.get("sections", [])
        wines = data.get("wines", [])

    return {
        "restaurant_name": data.get("restaurant_name", menu.restaurant_name),
        "lang": lang,
        "available_languages": [lng.strip() for lng in menu.languages.split(",")],
        "currency": data.get("currency"),
        "sections": sections,
        "wines": wines,
    }


def get_full_menu_data(menu: Menu) -> dict:
    return json.loads(menu.menu_data)
