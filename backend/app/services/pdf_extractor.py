"""PDF text extractor utility using PyMuPDF (fitz)."""
from pathlib import Path

import fitz


def extract_pdf_text(file_path: Path) -> str:
    """Extract all text from a PDF file, concatenating pages with newlines.

    Args:
        file_path: Path to the PDF file.

    Returns:
        Extracted text as a single string.

    Raises:
        FileNotFoundError: If the file does not exist.
        ValueError: If the file cannot be parsed as PDF.
    """
    if not file_path.exists():
        raise FileNotFoundError(f"File not found: {file_path}")

    try:
        doc = fitz.open(str(file_path))
    except Exception as e:
        raise ValueError(f"Failed to parse PDF: {file_path} — {e}") from e

    pages = []
    for page in doc:
        text = page.get_text()
        if text:
            pages.append(text)
    doc.close()

    return "\n".join(pages)
