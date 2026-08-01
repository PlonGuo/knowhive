"""CLI entry: stdio batch protocol (host-facing) + one-shot mode (debugging).

Protocol (`knowhive-pdf --stdio`), one JSON object per line on stdout:

    → {"type":"ready","schema_version":1,"plugin_version":"0.1.0","docling_version":"..."}
    ← /path/to/file.pdf\n                (one path per stdin line)
    → {"type":"result","path":"...","ir":{"format":"pdf","blocks":[...]}}
    → {"type":"error","path":"...","code":"needs_ocr|bad_text_layer|parse_failed","message":"..."}

Triage runs before docling, so scanned/broken files come back in milliseconds
and never trigger the (seconds-long, model-loading) conversion pipeline.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import SCHEMA_VERSION, __version__
from .mapping import convert_pdf
from .triage import triage_pdf


def _emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def process_file(path: str) -> dict:
    if not Path(path).is_file():
        return {"type": "error", "path": path, "code": "parse_failed", "message": "file not found"}
    try:
        t = triage_pdf(path)
        if t.code != "ok":
            return {"type": "error", "path": path, "code": t.code, "message": t.message}
        blocks = convert_pdf(path)
        return {"type": "result", "path": path, "ir": {"format": "pdf", "blocks": blocks}}
    except Exception as e:  # noqa: BLE001 — protocol boundary: everything becomes an error line
        return {"type": "error", "path": path, "code": "parse_failed", "message": str(e)}


def run_stdio() -> None:
    try:
        from docling import __version__ as docling_version
    except Exception:  # pragma: no cover
        docling_version = "unknown"
    _emit(
        {
            "type": "ready",
            "schema_version": SCHEMA_VERSION,
            "plugin_version": __version__,
            "docling_version": docling_version,
        }
    )
    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        _emit(process_file(path))


def prefetch_models() -> None:
    """Download docling's layout/table models ahead of time.

    The host runs this right after `uv tool install`, so the user's first real
    parse doesn't stall on a multi-hundred-MB HuggingFace download. Honors
    HF_ENDPOINT for mirror setups.
    """
    from docling.utils.model_downloader import download_models

    download_models(with_easyocr=False)  # v1 has no OCR
    _emit({"type": "models_ready"})


def main() -> None:
    ap = argparse.ArgumentParser(description="KnowHive PDF plugin: PDF → DocumentIR JSON")
    ap.add_argument("pdf", nargs="?", help="one-shot mode: parse a single PDF and print its IR")
    ap.add_argument("--stdio", action="store_true", help="batch mode: paths on stdin, JSONL on stdout")
    ap.add_argument(
        "--prefetch-models", action="store_true", help="download docling models now (install-time warmup)"
    )
    args = ap.parse_args()

    if args.prefetch_models:
        prefetch_models()
        return
    if args.stdio:
        run_stdio()
        return
    if not args.pdf:
        ap.error("provide a PDF path or --stdio")
    result = process_file(args.pdf)
    _emit(result)
    if result["type"] == "error":
        sys.exit(1)


if __name__ == "__main__":
    main()
