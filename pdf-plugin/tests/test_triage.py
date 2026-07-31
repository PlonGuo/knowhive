from pathlib import Path

from knowhive_pdf.triage import triage_pdf

FIXTURES = Path(__file__).parent / "fixtures"


def test_text_layer_pdf_is_ok():
    r = triage_pdf(str(FIXTURES / "zh-textlayer.pdf"))
    assert r.code == "ok"
    assert max(r.chars_per_page) > 50


def test_scanned_pdf_needs_ocr():
    r = triage_pdf(str(FIXTURES / "zh-scanned.pdf"))
    assert r.code == "needs_ocr"


def test_broken_text_layer_detected():
    # pdf.js issue9534_reduced: the page renders text but extraction yields
    # almost nothing — the silent-garbage case triage exists for.
    r = triage_pdf(str(FIXTURES / "bad-textlayer.pdf"))
    assert r.code == "bad_text_layer"
