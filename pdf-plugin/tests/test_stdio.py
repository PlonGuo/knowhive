"""Protocol test: spawn the real CLI, feed paths, read JSONL.

Uses only triage-rejected fixtures so the test never loads docling's layout
models — the full-parse path is covered by the slow opt-in test below.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def run_stdio(paths: list[str]) -> list[dict]:
    proc = subprocess.run(
        [sys.executable, "-m", "knowhive_pdf.cli", "--stdio"],
        input="\n".join(paths) + "\n",
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert proc.returncode == 0, proc.stderr
    return [json.loads(line) for line in proc.stdout.strip().split("\n")]


def test_handshake_and_error_lines():
    lines = run_stdio(
        [str(FIXTURES / "zh-scanned.pdf"), str(FIXTURES / "bad-textlayer.pdf"), "/nope.pdf"]
    )
    ready, scanned, broken, missing = lines
    assert ready["type"] == "ready"
    assert ready["schema_version"] == 1
    assert scanned == {
        "type": "error",
        "path": str(FIXTURES / "zh-scanned.pdf"),
        "code": "needs_ocr",
        "message": scanned["message"],
    }
    assert broken["code"] == "bad_text_layer"
    assert missing["code"] == "parse_failed"


@pytest.mark.skipif(
    not os.environ.get("KNOWHIVE_PDF_SLOW"),
    reason="full docling parse (downloads layout models); set KNOWHIVE_PDF_SLOW=1",
)
def test_full_parse_emits_ir():
    lines = run_stdio([str(FIXTURES / "zh-textlayer.pdf")])
    result = lines[1]
    assert result["type"] == "result"
    ir = result["ir"]
    assert ir["format"] == "pdf"
    types = {b["type"] for b in ir["blocks"]}
    assert "heading" in types and "table" in types
    # NFKC applied: no Kangxi radicals survive into the IR.
    assert not any("⼀" in b["text"] or "⽗" in b["text"] for b in ir["blocks"])
    # Table blocks start at the header row (splitTable contract).
    for b in ir["blocks"]:
        if b["type"] == "table":
            assert b["text"].startswith("|")
