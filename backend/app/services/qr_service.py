import io
import os

import qrcode
import qrcode.constants
from PIL import Image

from app.config import BASE_URL, STORAGE_DIR
from app.services.file_service import ensure_dirs


def generate_qr(slug: str) -> str:
    """Generate a menu QR code, save to local storage, return public URL."""
    ensure_dirs()
    url = f"{BASE_URL}/menu/{slug}"
    filename = f"{slug}.png"
    path = os.path.join(STORAGE_DIR, "qr", filename)
    img = qrcode.make(url)
    img.save(path)
    return f"{BASE_URL}/storage/qr/{filename}"


def generate_table_qr_bytes(
    menu_slug: str,
    qr_token: str,
    fill_color: str = "black",
    back_color: str = "white",
    logo_data: bytes | None = None,
) -> bytes:
    """Return PNG bytes for a table QR code with optional color and logo customization.

    Args:
        menu_slug:   Menu slug used to build the QR URL.
        qr_token:    Unique table token embedded in the URL.
        fill_color:  QR module color (hex or named color, e.g. "black", "#1a1a1a").
        back_color:  QR background color (hex or named color, e.g. "white", "#ffffff").
        logo_data:   Optional PNG/JPEG bytes for a logo to overlay in the center.
    """
    url = f"{BASE_URL}/menu/{menu_slug}?table={qr_token}"

    # Use higher error correction when logo will obscure the center
    error_correction = (
        qrcode.constants.ERROR_CORRECT_H if logo_data else qrcode.constants.ERROR_CORRECT_M
    )

    qr = qrcode.QRCode(
        version=1,
        error_correction=error_correction,
        box_size=10,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=fill_color, back_color=back_color).convert("RGBA")

    if logo_data:
        try:
            logo = Image.open(io.BytesIO(logo_data)).convert("RGBA")
            qr_w, qr_h = img.size
            max_logo = qr_w // 5  # logo occupies ~20% of QR width
            logo.thumbnail((max_logo, max_logo), Image.LANCZOS)
            logo_w, logo_h = logo.size
            pos = ((qr_w - logo_w) // 2, (qr_h - logo_h) // 2)

            # White padding behind logo for readability
            pad = 4
            bg = Image.new("RGBA", (logo_w + pad * 2, logo_h + pad * 2), (255, 255, 255, 255))
            img.paste(bg, (pos[0] - pad, pos[1] - pad))
            img.paste(logo, pos, logo)
        except Exception:
            pass  # Skip logo if processing fails; return plain QR

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()
