"""Spike: docling → DocumentIR mapping quality check (plugin v1 groundwork).

Converts a PDF with docling (no OCR — v1 scope) and maps the result onto the
TS side's DocumentIR block shape:

    { type: heading|paragraph|list|table|code|quote,
      text, level?, order, page?, bbox? }

Prints the mapped blocks as JSON plus a shape summary, so we can judge:
  - heading detection + levels (section tree quality)
  - reading order across two-column layouts
  - table serialization (MUST be pipe-markdown with a separator row — the TS
    chunker's splitTable() keys on "line 1 = header, line 2 = |---|" to repeat
    headers when splitting oversized tables)

Run (from backend/):
    uv run python spike_docling_ir.py /path/to/file.pdf [--json out.json]
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


def convert(pdf_path: Path) -> list[dict]:
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling_core.types.doc import DocItemLabel, TableItem, TextItem

    # v1 scope: text-layer PDFs only. OCR off keeps the pipeline lean; scanned
    # pages simply come back empty (the real plugin turns that into needs_ocr).
    opts = PdfPipelineOptions()
    opts.do_ocr = False
    opts.do_table_structure = True

    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
    )
    doc = converter.convert(pdf_path).document

    # Docling label → our BlockType. Everything prose-like folds into paragraph;
    # picture/caption/footnote stay out of v1 (captions could ride later).
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

    blocks: list[dict] = []

    def push(block: dict, item) -> None:
        prov = getattr(item, "prov", None)
        if prov:
            block["page"] = prov[0].page_no
            bb = prov[0].bbox
            block["bbox"] = [round(bb.l, 1), round(bb.t, 1), round(bb.r, 1), round(bb.b, 1)]
        block["order"] = len(blocks)
        blocks.append(block)

    for item, _level in doc.iterate_items():
        if isinstance(item, TableItem):
            md = item.export_to_markdown(doc=doc)
            # export_to_markdown prepends the caption + a blank line. The TS
            # chunker's splitTable() requires line 1 = header row, line 2 =
            # separator — so the caption becomes its own paragraph block and the
            # table block starts at the first pipe row.
            lines = md.split("\n")
            first_pipe = next((i for i, l in enumerate(lines) if l.startswith("|")), None)
            caption = "\n".join(lines[: first_pipe or 0]).strip()
            table_md = "\n".join(lines[first_pipe:]).strip() if first_pipe is not None else ""
            if caption:
                push({"type": "paragraph", "text": caption}, item)
            if table_md:
                push({"type": "table", "text": table_md}, item)
        elif isinstance(item, TextItem):
            text = (item.text or "").strip()
            if not text:
                continue
            btype = label_map.get(item.label)
            if btype is None:
                continue  # page headers/footers/footnotes: navigation noise, skip
            block = {"type": btype, "text": text}
            if btype == "heading":
                # Docling reports section headers at a flat depth, so numbered
                # headings ("3", "3.1", "3.1.2") carry the real hierarchy. Title
                # items are level 1; unnumbered section headers default to 2.
                block["level"] = (
                    1 if item.label == DocItemLabel.TITLE else heading_level_from_numbering(text)
                )
            push(block, item)

    return blocks


def heading_level_from_numbering(text: str) -> int:
    """"3 BERT"→2, "3.1 Pre-training"→3, unnumbered→2 (doc title holds level 1)."""
    lead = text.split(" ", 1)[0].rstrip(".")
    parts = lead.split(".")
    if all(p.isdigit() for p in parts) and parts[0]:
        return min(6, 1 + len(parts))
    return 2


def summarize(blocks: list[dict]) -> dict:
    counts = Counter(b["type"] for b in blocks)
    headings = [b for b in blocks if b["type"] == "heading"]
    tables = [b for b in blocks if b["type"] == "table"]
    return {
        "blocks": len(blocks),
        "by_type": dict(counts),
        "chars": sum(len(b["text"]) for b in blocks),
        "headings": [f"p{b.get('page', '?')} L{b.get('level')} {b['text'][:60]}" for b in headings[:15]],
        "table_first_lines": [t["text"].split("\n")[:2] for t in tables[:3]],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", type=Path)
    ap.add_argument("--json", type=Path, help="write full mapped blocks here")
    args = ap.parse_args()

    blocks = convert(args.pdf)
    if args.json:
        args.json.write_text(json.dumps({"format": "pdf", "blocks": blocks}, ensure_ascii=False, indent=1))
        print(f"wrote {args.json}", file=sys.stderr)
    print(json.dumps(summarize(blocks), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
