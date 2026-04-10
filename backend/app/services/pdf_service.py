"""QR code PDF generator for table management.

Generates an A4 PDF with one QR code per table arranged in a 2-column grid.
Each cell shows: QR code image + table number + zone label.

Requires: reportlab, Pillow, qrcode (already in requirements.txt).
"""

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import (
    Image,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_CENTER

from app.services.qr_service import generate_table_qr_bytes


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

_title_style = ParagraphStyle(
    "title",
    fontSize=18,
    leading=22,
    alignment=TA_CENTER,
    spaceAfter=6,
)

_subtitle_style = ParagraphStyle(
    "subtitle",
    fontSize=10,
    leading=13,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#6b7280"),
    spaceAfter=20,
)

_table_number_style = ParagraphStyle(
    "table_number",
    fontSize=14,
    leading=18,
    alignment=TA_CENTER,
    fontName="Helvetica-Bold",
)

_zone_style = ParagraphStyle(
    "zone",
    fontSize=9,
    leading=12,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#6b7280"),
)

_scan_style = ParagraphStyle(
    "scan",
    fontSize=8,
    leading=11,
    alignment=TA_CENTER,
    textColor=colors.HexColor("#9ca3af"),
)

QR_SIZE = 4.5 * cm   # QR image dimensions inside each cell
CELL_WIDTH = 8 * cm
CELL_HEIGHT = 7.2 * cm


def _make_table_cell(
    table_obj: Any,
    fill_color: str = "black",
    back_color: str = "white",
    logo_data: bytes | None = None,
) -> list:
    """Build a list of flowables for one table cell."""
    qr_bytes = generate_table_qr_bytes(
        table_obj.menu_slug,
        table_obj.qr_token,
        fill_color=fill_color,
        back_color=back_color,
        logo_data=logo_data,
    )
    qr_img = Image(io.BytesIO(qr_bytes), width=QR_SIZE, height=QR_SIZE)

    number_para = Paragraph(f"Table {table_obj.number}", _table_number_style)
    zone_para = Paragraph(table_obj.label or "", _zone_style)
    scan_para = Paragraph("Scannez pour voir le menu", _scan_style)

    return [qr_img, Spacer(1, 0.15 * cm), number_para, zone_para, scan_para]


def generate_qr_pdf(
    tables: list,
    restaurant_name: str,
    menu_slug: str,
    fill_color: str = "black",
    back_color: str = "white",
    logo_data: bytes | None = None,
) -> bytes:
    """Generate an A4 PDF with all table QR codes (2-column grid).

    Args:
        tables:          list of Table ORM objects
        restaurant_name: shown as PDF title
        menu_slug:       used in subtitle
        fill_color:      QR module color (default "black")
        back_color:      QR background color (default "white")
        logo_data:       Optional logo bytes to overlay on each QR code

    Returns:
        Raw PDF bytes.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=1.5 * cm,
        rightMargin=1.5 * cm,
        topMargin=1.5 * cm,
        bottomMargin=1.5 * cm,
    )

    story = []

    # Header
    story.append(Paragraph(restaurant_name, _title_style))
    story.append(Paragraph(f"Codes QR — menu /{menu_slug}", _subtitle_style))

    # Build 2-column table of QR cells
    cells_per_row = 2
    rows = []
    current_row: list = []

    for t in tables:
        if not t.is_active:
            continue
        cell_content = _make_table_cell(t, fill_color=fill_color, back_color=back_color, logo_data=logo_data)
        current_row.append(cell_content)
        if len(current_row) == cells_per_row:
            rows.append(current_row)
            current_row = []

    # Pad last row if odd number of tables
    if current_row:
        current_row.append("")
        rows.append(current_row)

    if rows:
        col_widths = [CELL_WIDTH, CELL_WIDTH]
        pdf_table = Table(rows, colWidths=col_widths, rowHeights=[CELL_HEIGHT] * len(rows))
        pdf_table.setStyle(
            TableStyle([
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
                ("BACKGROUND", (0, 0), (-1, -1), colors.white),
                ("TOPPADDING", (0, 0), (-1, -1), 8),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ])
        )
        story.append(pdf_table)
    else:
        story.append(Paragraph("Aucune table active.", _subtitle_style))

    doc.build(story)
    return buf.getvalue()
