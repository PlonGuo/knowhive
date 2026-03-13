"""Tests for PDF text extractor utility."""
import fitz  # PyMuPDF
import pytest
from pathlib import Path

from app.services.pdf_extractor import extract_pdf_text


@pytest.fixture
def sample_pdf(tmp_path: Path) -> Path:
    """Create a simple PDF with known text content."""
    pdf_path = tmp_path / "sample.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "Hello World\nThis is a test PDF.")
    doc.save(str(pdf_path))
    doc.close()
    return pdf_path


@pytest.fixture
def multi_page_pdf(tmp_path: Path) -> Path:
    """Create a multi-page PDF."""
    pdf_path = tmp_path / "multi.pdf"
    doc = fitz.open()
    for i in range(3):
        page = doc.new_page()
        page.insert_text((72, 72), f"Page {i + 1} content here.")
    doc.save(str(pdf_path))
    doc.close()
    return pdf_path


@pytest.fixture
def empty_pdf(tmp_path: Path) -> Path:
    """Create a PDF with no text (blank page)."""
    pdf_path = tmp_path / "empty.pdf"
    doc = fitz.open()
    doc.new_page()
    doc.save(str(pdf_path))
    doc.close()
    return pdf_path


def test_extract_single_page(sample_pdf: Path):
    """Extract text from a single-page PDF."""
    text = extract_pdf_text(sample_pdf)
    assert "Hello World" in text
    assert "test PDF" in text


def test_extract_multi_page(multi_page_pdf: Path):
    """Extract text from all pages of a multi-page PDF."""
    text = extract_pdf_text(multi_page_pdf)
    assert "Page 1" in text
    assert "Page 2" in text
    assert "Page 3" in text


def test_extract_empty_pdf(empty_pdf: Path):
    """Empty PDF returns empty string."""
    text = extract_pdf_text(empty_pdf)
    assert text.strip() == ""


def test_file_not_found(tmp_path: Path):
    """Non-existent file raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        extract_pdf_text(tmp_path / "nonexistent.pdf")


def test_invalid_pdf(tmp_path: Path):
    """Non-PDF file raises ValueError."""
    bad_file = tmp_path / "not_a_pdf.pdf"
    bad_file.write_text("this is not a pdf")
    with pytest.raises(ValueError, match="Failed to parse PDF"):
        extract_pdf_text(bad_file)


def test_return_type(sample_pdf: Path):
    """extract_pdf_text returns a string."""
    result = extract_pdf_text(sample_pdf)
    assert isinstance(result, str)
