"""Cheap pre-flight triage: decide whether a PDF is worth running docling on.

Runs pypdfium2 text extraction only (milliseconds, no ML models). Catches the
two failure shapes that would otherwise fail SILENTLY — a scanned PDF parsed
with OCR off yields empty text, and a broken text layer (CID/cmap damage)
yields garbage that would be embedded as if it were real content.

Thresholds calibrated against real samples (2026-08-01):
  - scanned page (image-only):        0 chars/page
  - pdf.js issue9534 (broken layer):  15 chars on a visibly full page
  - normal papers:                    thousands of chars/page, garbage ≈ 0.5%
"""
from __future__ import annotations

from dataclasses import dataclass
from statistics import median

# A page with fewer extractable chars than this is not a text page.
MIN_CHARS_PER_PAGE = 50
# Share of private-use/replacement chars above which the layer is garbage.
MAX_GARBAGE_RATIO = 0.10


@dataclass
class TriageResult:
    code: str  # "ok" | "needs_ocr" | "bad_text_layer"
    message: str
    chars_per_page: list[int]


def _is_garbage_char(c: str) -> bool:
    cp = ord(c)
    return 0xE000 <= cp <= 0xF8FF or c == "�"


def _page_has_image(page) -> bool:
    # FPDF_PAGEOBJ_IMAGE == 3 in pdfium's page-object enum.
    return any(obj.type == 3 for obj in page.get_objects())


def triage_pdf(pdf_path: str) -> TriageResult:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(pdf_path)
    try:
        texts = [doc[i].get_textpage().get_text_bounded() for i in range(len(doc))]
        chars_per_page = [len(t.strip()) for t in texts]
        all_text = "".join(texts)

        if all_text:
            garbage = sum(1 for c in all_text if _is_garbage_char(c)) / len(all_text)
            if garbage > MAX_GARBAGE_RATIO:
                return TriageResult(
                    "bad_text_layer",
                    f"{garbage:.0%} of extracted characters are unmapped glyphs",
                    chars_per_page,
                )

        if median(chars_per_page) < MIN_CHARS_PER_PAGE:
            # Distinguish "pages are pictures" from "pages should have text but
            # the layer is broken": image-dominated pages mean a scan.
            scannish = any(_page_has_image(doc[i]) for i in range(min(3, len(doc))))
            if scannish:
                return TriageResult(
                    "needs_ocr",
                    "pages are images with no usable text layer (scanned document)",
                    chars_per_page,
                )
            return TriageResult(
                "bad_text_layer",
                "pages render content but the text layer is empty or broken",
                chars_per_page,
            )

        return TriageResult("ok", "", chars_per_page)
    finally:
        doc.close()
