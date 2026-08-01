"""docling result → DocumentIR blocks (the TS side's documentIr.ts shape).

Three quirks this mapping exists to absorb (found in the 2026-08-01 spike):

1. Docling reports section headers at a flat tree depth, so the real hierarchy
   lives in the numbering — "3.1 Pre-training" is level 3, "3 BERT" level 2.
2. TableItem.export_to_markdown prepends the caption and a blank line. The TS
   chunker's splitTable() requires line 1 = header row / line 2 = separator to
   repeat headers when splitting oversized tables, so the caption becomes its
   own paragraph block and the table block starts at the first pipe row.
3. Subsetted CJK fonts map some ideographs to Kangxi-radical codepoints
   (⼀ U+2F00 instead of 一 U+4E00) — visually identical, retrieval-fatal.
   NFKC normalization folds them back (and full-width ASCII, ligatures too).
"""
from __future__ import annotations

import unicodedata
from typing import Any

_converter = None


def get_converter():
    """Singleton DocumentConverter — model load costs seconds, pay it once."""
    global _converter
    if _converter is None:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        opts = PdfPipelineOptions()
        # v1 scope: text-layer PDFs only. Scanned files never reach docling —
        # triage_pdf() returns needs_ocr first.
        opts.do_ocr = False
        opts.do_table_structure = True
        _converter = DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
        )
    return _converter


def normalize_text(text: str) -> str:
    return unicodedata.normalize("NFKC", text).strip()


import re

_CN_NUMERAL = "一二三四五六七八九十百"
# 一、概述  /  十二、总结
_CN_CHAPTER = re.compile(rf"^[{_CN_NUMERAL}]+[、.．]")
# （一）  /  (一)
_CN_SECTION = re.compile(rf"^[（(][{_CN_NUMERAL}]+[）)]")
# 1.  /  1、  (single arabic — third level, but only inside a Chinese-numbered doc)
_ARABIC_ITEM = re.compile(r"^\d+[.、]\s")


def heading_level_from_numbering(text: str) -> int:
    """"3 BERT"→2, "3.1 Pre-training"→3; unnumbered→2 (doc title holds 1)."""
    lead = text.split(" ", 1)[0].rstrip(".")
    parts = lead.split(".")
    if parts and parts[0] and all(p.isdigit() for p in parts):
        return min(6, 1 + len(parts))
    return 2


def refine_chinese_heading_levels(blocks: list[dict[str, Any]]) -> None:
    """Second pass: Chinese official-document numbering (一、 → （一） → 1.).

    "1." is ambiguous — chapter-level in English papers, third-level in Chinese
    whitepapers — so the Chinese scheme only applies when the document actually
    uses 一、-style chapter headings. Mutates heading levels in place.
    """
    headings = [b for b in blocks if b.get("type") == "heading"]
    if not any(_CN_CHAPTER.match(h["text"]) for h in headings):
        return
    for h in headings:
        if _CN_CHAPTER.match(h["text"]):
            h["level"] = 2
        elif _CN_SECTION.match(h["text"]):
            h["level"] = 3
        elif _ARABIC_ITEM.match(h["text"]):
            h["level"] = 4


def split_table_markdown(md: str) -> tuple[str, str]:
    """Split docling's table markdown into (caption, pipe-table)."""
    lines = md.split("\n")
    first_pipe = next((i for i, l in enumerate(lines) if l.startswith("|")), None)
    if first_pipe is None:
        return md.strip(), ""
    caption = "\n".join(lines[:first_pipe]).strip()
    table_md = "\n".join(lines[first_pipe:]).strip()
    return caption, table_md


def convert_pdf(pdf_path: str) -> list[dict[str, Any]]:
    from docling_core.types.doc import DocItemLabel, TableItem, TextItem

    doc = get_converter().convert(pdf_path).document

    label_map = {
        DocItemLabel.TITLE: "heading",
        DocItemLabel.SECTION_HEADER: "heading",
        DocItemLabel.TEXT: "paragraph",
        DocItemLabel.PARAGRAPH: "paragraph",
        DocItemLabel.LIST_ITEM: "list",
        DocItemLabel.CODE: "code",
        DocItemLabel.FORMULA: "paragraph",
        DocItemLabel.CAPTION: "paragraph",
    }

    blocks: list[dict[str, Any]] = []

    def push(block: dict[str, Any], item: Any) -> None:
        prov = getattr(item, "prov", None)
        if prov:
            block["page"] = prov[0].page_no
            bb = prov[0].bbox
            block["bbox"] = [round(bb.l, 1), round(bb.t, 1), round(bb.r, 1), round(bb.b, 1)]
        block["order"] = len(blocks)
        blocks.append(block)

    for item, _level in doc.iterate_items():
        if isinstance(item, TableItem):
            caption, table_md = split_table_markdown(item.export_to_markdown(doc=doc))
            if caption:
                push({"type": "paragraph", "text": normalize_text(caption)}, item)
            if table_md:
                push({"type": "table", "text": normalize_text(table_md)}, item)
        elif isinstance(item, TextItem):
            text = normalize_text(item.text or "")
            if not text:
                continue
            btype = label_map.get(item.label)
            if btype is None:
                continue  # page furniture (headers/footers/footnotes): skip
            block: dict[str, Any] = {"type": btype, "text": text}
            if btype == "heading":
                block["level"] = (
                    1 if item.label == DocItemLabel.TITLE else heading_level_from_numbering(text)
                )
            push(block, item)

    refine_chinese_heading_levels(blocks)
    return blocks
