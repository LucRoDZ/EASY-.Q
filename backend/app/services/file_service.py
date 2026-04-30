import os
import secrets
from app.config import STORAGE_DIR


def ensure_dirs():
    os.makedirs(STORAGE_DIR, exist_ok=True)
    os.makedirs(os.path.join(STORAGE_DIR, "uploads"), exist_ok=True)
    os.makedirs(os.path.join(STORAGE_DIR, "qr"), exist_ok=True)


def save_pdf(content: bytes, original_filename: str) -> str:
    ensure_dirs()
    token = secrets.token_hex(8)
    safe_name = os.path.basename(original_filename).replace(" ", "_")
    if not safe_name.lower().endswith(".pdf"):
        safe_name += ".pdf"
    filename = f"{token}_{safe_name}"
    path = os.path.join(STORAGE_DIR, "uploads", filename)
    with open(path, "wb") as f:
        f.write(content)
    return path


def save_upload_file(content: bytes, original_filename: str) -> str:
    """Save any uploaded file (PDF or image) preserving its original extension."""
    ensure_dirs()
    token = secrets.token_hex(8)
    safe_name = os.path.basename(original_filename).replace(" ", "_")
    # Ensure there is some extension; fall back to .bin for unknown types
    if "." not in safe_name:
        safe_name += ".bin"
    filename = f"{token}_{safe_name}"
    path = os.path.join(STORAGE_DIR, "uploads", filename)
    with open(path, "wb") as f:
        f.write(content)
    return path


def is_valid_pdf(content: bytes) -> bool:
    return len(content) >= 5 and content[:5] == b"%PDF-"


def detect_mime_type(content: bytes, filename: str) -> str:
    """Detect MIME type from magic bytes. Falls back to filename extension."""
    if content[:5] == b"%PDF-":
        return "application/pdf"
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(content) >= 12 and content[8:12] == b"WEBP":
        return "image/webp"
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    return {"pdf": "application/pdf", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "png": "image/png", "webp": "image/webp"}.get(ext, "application/octet-stream")
