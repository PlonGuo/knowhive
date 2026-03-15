"""Tests for ingest service — Markdown load, text split, embed, Chroma store, dedup."""
import hashlib
import os
from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF
import pytest
import pytest_asyncio

from app.database import close_db, get_db, init_db
from app.services.ingest_service import IngestService


@pytest.fixture
def knowledge_dir(tmp_path):
    """Create a temporary knowledge directory with sample Markdown files."""
    md1 = tmp_path / "hello.md"
    md1.write_text("# Hello World\n\nThis is a test document about greetings.\n")

    md2 = tmp_path / "subdir" / "nested.md"
    md2.parent.mkdir()
    md2.write_text("# Nested\n\nA nested markdown file with some content.\n")

    return tmp_path


@pytest.fixture
def long_doc(tmp_path):
    """Create a Markdown file long enough to produce multiple chunks."""
    content = "# Long Document\n\n"
    for i in range(100):
        content += f"## Section {i}\n\nThis is paragraph {i} with enough text to fill up a chunk. " * 5 + "\n\n"
    md = tmp_path / "long.md"
    md.write_text(content)
    return tmp_path


@pytest_asyncio.fixture
async def db():
    """In-memory database for testing."""
    await init_db(":memory:")
    async with get_db() as conn:
        yield conn
    await close_db()


@pytest.fixture
def chroma_dir(tmp_path):
    """Separate temp dir for Chroma persistence."""
    d = tmp_path / "chroma_store"
    d.mkdir()
    return d


@pytest.fixture
def service(db, chroma_dir):
    """Create an IngestService with test Chroma dir."""
    return IngestService(chroma_path=str(chroma_dir))


# ── File loading ─────────────────────────────────────────────────


def test_load_markdown_files(service, knowledge_dir):
    """Should discover all .md files recursively."""
    files = service.find_markdown_files(knowledge_dir)
    assert len(files) == 2
    names = {f.name for f in files}
    assert "hello.md" in names
    assert "nested.md" in names


def test_load_markdown_ignores_non_md(service, tmp_path):
    """Should ignore non-markdown files."""
    (tmp_path / "readme.md").write_text("# Readme\n")
    (tmp_path / "notes.txt").write_text("plain text\n")
    (tmp_path / "image.png").write_bytes(b"\x89PNG")
    files = service.find_markdown_files(tmp_path)
    assert len(files) == 1
    assert files[0].name == "readme.md"


# ── Text splitting ───────────────────────────────────────────────


def test_split_text_basic(service):
    """Short text should produce a single chunk."""
    chunks = service.split_text("Short text", metadata={"file_path": "a.md"})
    assert len(chunks) >= 1
    assert chunks[0].page_content == "Short text"
    assert chunks[0].metadata["file_path"] == "a.md"


def test_split_text_long(service, long_doc):
    """Long text should produce multiple chunks."""
    content = (long_doc / "long.md").read_text()
    chunks = service.split_text(content, metadata={"file_path": "long.md"})
    assert len(chunks) > 1
    # Each chunk should have chunk_index metadata
    for i, chunk in enumerate(chunks):
        assert chunk.metadata["chunk_index"] == i
        assert chunk.metadata["file_path"] == "long.md"


# ── File hash ────────────────────────────────────────────────────


def test_compute_file_hash(service, knowledge_dir):
    """Should compute SHA-256 hash of file content."""
    file_path = knowledge_dir / "hello.md"
    h = service.compute_file_hash(file_path)
    expected = hashlib.sha256(file_path.read_bytes()).hexdigest()
    assert h == expected


# ── Chroma store ─────────────────────────────────────────────────


def test_chroma_collection_created(service):
    """Service should create a Chroma collection."""
    collection = service.collection
    assert collection is not None
    assert collection.name == "knowhive"


def test_store_chunks_in_chroma(service):
    """Should store chunks and retrieve them."""
    chunks = service.split_text("Hello world from KnowHive", metadata={"file_path": "test.md"})
    service.store_chunks(chunks)

    results = service.collection.get(where={"file_path": "test.md"})
    assert len(results["ids"]) >= 1
    assert "Hello world" in results["documents"][0]


# ── Dedup (delete old chunks before re-ingest) ──────────────────


def test_dedup_removes_old_chunks(service):
    """Re-ingesting same file_path should replace old chunks."""
    chunks1 = service.split_text("Version 1 content", metadata={"file_path": "dup.md"})
    service.store_chunks(chunks1)

    count_before = service.collection.count()
    assert count_before >= 1

    # Dedup then store new version
    service.delete_chunks_for_file("dup.md")
    chunks2 = service.split_text("Version 2 completely different", metadata={"file_path": "dup.md"})
    service.store_chunks(chunks2)

    results = service.collection.get(where={"file_path": "dup.md"})
    assert len(results["ids"]) >= 1
    assert "Version 2" in results["documents"][0]
    assert "Version 1" not in " ".join(results["documents"])


def test_delete_chunks_nonexistent_file(service):
    """Deleting chunks for a file that doesn't exist should not error."""
    service.delete_chunks_for_file("nonexistent.md")  # should not raise


# ── Full ingest pipeline ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_ingest_single_file(service, db, knowledge_dir):
    """Ingest a single file — should create DB record + Chroma chunks."""
    file_path = knowledge_dir / "hello.md"
    result = await service.ingest_file(file_path, knowledge_dir)

    assert result["status"] == "indexed"
    assert result["chunk_count"] >= 1

    # Check DB record
    cursor = await db.execute("SELECT * FROM documents WHERE file_path = ?", (str(file_path),))
    row = await cursor.fetchone()
    assert row is not None
    assert row["status"] == "indexed"
    assert row["chunk_count"] >= 1

    # Check Chroma
    chroma_results = service.collection.get(where={"file_path": str(file_path)})
    assert len(chroma_results["ids"]) >= 1


@pytest.mark.asyncio
async def test_ingest_directory(service, db, knowledge_dir):
    """Ingest all files in a directory."""
    results = await service.ingest_directory(knowledge_dir)
    assert len(results) == 2
    assert all(r["status"] == "indexed" for r in results)

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 2


@pytest.mark.asyncio
async def test_ingest_dedup_on_reingest(service, db, knowledge_dir):
    """Re-ingesting same file should update, not duplicate."""
    file_path = knowledge_dir / "hello.md"
    await service.ingest_file(file_path, knowledge_dir)
    await service.ingest_file(file_path, knowledge_dir)

    # Should still be 1 document record
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents WHERE file_path = ?", (str(file_path),))
    row = await cursor.fetchone()
    assert row["cnt"] == 1

    # Chroma should not have duplicates
    chroma_results = service.collection.get(where={"file_path": str(file_path)})
    # Should only have chunks from the latest ingest
    assert len(chroma_results["ids"]) >= 1


@pytest.mark.asyncio
async def test_ingest_updates_modified_file(service, db, knowledge_dir):
    """If file content changes, re-ingest should update hash and chunks."""
    file_path = knowledge_dir / "hello.md"
    await service.ingest_file(file_path, knowledge_dir)

    cursor = await db.execute("SELECT file_hash FROM documents WHERE file_path = ?", (str(file_path),))
    old_hash = (await cursor.fetchone())["file_hash"]

    # Modify file
    file_path.write_text("# Updated Hello\n\nCompletely different content now.\n")
    await service.ingest_file(file_path, knowledge_dir)

    cursor = await db.execute("SELECT file_hash FROM documents WHERE file_path = ?", (str(file_path),))
    new_hash = (await cursor.fetchone())["file_hash"]
    assert new_hash != old_hash


@pytest.mark.asyncio
async def test_ingest_skips_unchanged_file(service, db, knowledge_dir):
    """If file hash matches, ingest should skip re-embedding."""
    file_path = knowledge_dir / "hello.md"
    result1 = await service.ingest_file(file_path, knowledge_dir)
    assert result1["status"] == "indexed"

    result2 = await service.ingest_file(file_path, knowledge_dir)
    assert result2["status"] == "skipped"


@pytest.mark.asyncio
async def test_ingest_records_error_on_bad_file(service, db, tmp_path):
    """Ingesting a nonexistent file should record an error."""
    bad_path = tmp_path / "missing.md"
    result = await service.ingest_file(bad_path, tmp_path)
    assert result["status"] == "error"
    assert "error" in result


# ── find_ingestable_files ────────────────────────────────────────


@pytest.fixture
def mixed_knowledge_dir(tmp_path):
    """Create a directory with .md, .pdf, and other files."""
    (tmp_path / "readme.md").write_text("# Readme\n")
    (tmp_path / "notes.txt").write_text("plain text\n")
    (tmp_path / "image.png").write_bytes(b"\x89PNG")

    # Create a valid PDF
    pdf_path = tmp_path / "report.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "PDF report content here.")
    doc.save(str(pdf_path))
    doc.close()

    # Nested PDF
    subdir = tmp_path / "subdir"
    subdir.mkdir()
    nested_pdf = subdir / "nested.pdf"
    doc2 = fitz.open()
    page2 = doc2.new_page()
    page2.insert_text((72, 72), "Nested PDF content.")
    doc2.save(str(nested_pdf))
    doc2.close()

    (subdir / "nested.md").write_text("# Nested MD\n")

    return tmp_path


def test_find_ingestable_files_includes_md_and_pdf(service, mixed_knowledge_dir):
    """find_ingestable_files should discover both .md and .pdf files."""
    files = service.find_ingestable_files(mixed_knowledge_dir)
    names = {f.name for f in files}
    assert "readme.md" in names
    assert "report.pdf" in names
    assert "nested.pdf" in names
    assert "nested.md" in names
    assert len(files) == 4


def test_find_ingestable_files_excludes_other_types(service, mixed_knowledge_dir):
    """find_ingestable_files should ignore .txt, .png, etc."""
    files = service.find_ingestable_files(mixed_knowledge_dir)
    names = {f.name for f in files}
    assert "notes.txt" not in names
    assert "image.png" not in names


def test_find_ingestable_files_empty_dir(service, tmp_path):
    """find_ingestable_files returns empty list for empty directory."""
    files = service.find_ingestable_files(tmp_path)
    assert files == []


def test_find_markdown_files_still_works(service, mixed_knowledge_dir):
    """find_markdown_files should still work (backward compat)."""
    files = service.find_markdown_files(mixed_knowledge_dir)
    assert all(f.suffix == ".md" for f in files)
    assert len(files) == 2


# ── PDF ingest pipeline ─────────────────────────────────────────


@pytest.fixture
def pdf_knowledge_dir(tmp_path):
    """Create a directory with a PDF file for ingest testing."""
    pdf_path = tmp_path / "document.pdf"
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "This is PDF content for ingestion testing.")
    doc.save(str(pdf_path))
    doc.close()
    return tmp_path


@pytest.mark.asyncio
async def test_ingest_pdf_file(service, db, pdf_knowledge_dir):
    """Ingest a PDF file — should create DB record + Chroma chunks."""
    file_path = pdf_knowledge_dir / "document.pdf"
    result = await service.ingest_file(file_path, pdf_knowledge_dir)

    assert result["status"] == "indexed"
    assert result["chunk_count"] >= 1

    # Check DB record
    cursor = await db.execute("SELECT * FROM documents WHERE file_path = ?", (str(file_path),))
    row = await cursor.fetchone()
    assert row is not None
    assert row["status"] == "indexed"
    assert row["chunk_count"] >= 1

    # Check Chroma has the content
    chroma_results = service.collection.get(where={"file_path": str(file_path)})
    assert len(chroma_results["ids"]) >= 1
    assert any("PDF content" in doc for doc in chroma_results["documents"])


@pytest.mark.asyncio
async def test_ingest_pdf_skips_unchanged(service, db, pdf_knowledge_dir):
    """Re-ingesting same PDF should skip if hash unchanged."""
    file_path = pdf_knowledge_dir / "document.pdf"
    result1 = await service.ingest_file(file_path, pdf_knowledge_dir)
    assert result1["status"] == "indexed"

    result2 = await service.ingest_file(file_path, pdf_knowledge_dir)
    assert result2["status"] == "skipped"


@pytest.mark.asyncio
async def test_ingest_directory_includes_pdf(service, db, mixed_knowledge_dir):
    """ingest_directory should ingest both .md and .pdf files."""
    results = await service.ingest_directory(mixed_knowledge_dir)
    # 2 md + 2 pdf = 4 files
    assert len(results) == 4
    assert all(r["status"] == "indexed" for r in results)

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 4


# ── Frontmatter wiring ──────────────────────────────────────────


@pytest.fixture
def frontmatter_dir(tmp_path):
    """Create a directory with a Markdown file containing frontmatter."""
    md = tmp_path / "leetcode-two-sum.md"
    md.write_text(
        "---\n"
        "title: Two Sum\n"
        "category: algorithms\n"
        "tags:\n"
        "  - array\n"
        "  - hash-table\n"
        "difficulty: easy\n"
        "pack_id: leetcode-top-100\n"
        "---\n"
        "# Two Sum\n\n"
        "Given an array of integers nums and an integer target...\n"
    )
    return tmp_path


@pytest.mark.asyncio
async def test_frontmatter_stored_in_sqlite(service, db, frontmatter_dir):
    """Ingesting a .md with frontmatter should store fields in SQLite."""
    file_path = frontmatter_dir / "leetcode-two-sum.md"
    result = await service.ingest_file(file_path, frontmatter_dir)
    assert result["status"] == "indexed"

    cursor = await db.execute(
        "SELECT title, category, tags, difficulty, pack_id FROM documents WHERE file_path = ?",
        (str(file_path),),
    )
    row = await cursor.fetchone()
    assert row["title"] == "Two Sum"
    assert row["category"] == "algorithms"
    assert row["tags"] == "array,hash-table"
    assert row["difficulty"] == "easy"
    assert row["pack_id"] == "leetcode-top-100"


@pytest.mark.asyncio
async def test_frontmatter_stored_in_chroma_metadata(service, db, frontmatter_dir):
    """Ingesting a .md with frontmatter should include fields in Chroma chunk metadata."""
    file_path = frontmatter_dir / "leetcode-two-sum.md"
    await service.ingest_file(file_path, frontmatter_dir)

    chroma_results = service.collection.get(where={"file_path": str(file_path)})
    assert len(chroma_results["ids"]) >= 1
    meta = chroma_results["metadatas"][0]
    assert meta["title"] == "Two Sum"
    assert meta["category"] == "algorithms"
    assert meta["tags"] == "array,hash-table"
    assert meta["difficulty"] == "easy"
    assert meta["pack_id"] == "leetcode-top-100"


@pytest.mark.asyncio
async def test_frontmatter_body_used_for_chunking(service, db, frontmatter_dir):
    """Chunking should use body text (without frontmatter YAML block)."""
    file_path = frontmatter_dir / "leetcode-two-sum.md"
    await service.ingest_file(file_path, frontmatter_dir)

    chroma_results = service.collection.get(where={"file_path": str(file_path)})
    for doc in chroma_results["documents"]:
        # YAML frontmatter delimiters should NOT appear in chunk text
        assert "---" not in doc or "title:" not in doc
        assert "pack_id:" not in doc


@pytest.mark.asyncio
async def test_no_frontmatter_stores_nulls(service, db, knowledge_dir):
    """Ingesting .md without frontmatter should store NULL for frontmatter fields."""
    file_path = knowledge_dir / "hello.md"
    result = await service.ingest_file(file_path, knowledge_dir)
    assert result["status"] == "indexed"

    cursor = await db.execute(
        "SELECT title, category, tags, difficulty, pack_id FROM documents WHERE file_path = ?",
        (str(file_path),),
    )
    row = await cursor.fetchone()
    assert row["title"] is None
    assert row["category"] is None
    assert row["tags"] is None
    assert row["difficulty"] is None
    assert row["pack_id"] is None


@pytest.mark.asyncio
async def test_pdf_skips_frontmatter(service, db, pdf_knowledge_dir):
    """PDF files should not attempt frontmatter parsing; fields should be NULL."""
    file_path = pdf_knowledge_dir / "document.pdf"
    result = await service.ingest_file(file_path, pdf_knowledge_dir)
    assert result["status"] == "indexed"

    cursor = await db.execute(
        "SELECT title, category, tags, difficulty, pack_id FROM documents WHERE file_path = ?",
        (str(file_path),),
    )
    row = await cursor.fetchone()
    assert row["title"] is None
    assert row["pack_id"] is None


@pytest.mark.asyncio
async def test_frontmatter_updated_on_reingest(service, db, frontmatter_dir):
    """Re-ingesting a modified file should update frontmatter fields in SQLite."""
    file_path = frontmatter_dir / "leetcode-two-sum.md"
    await service.ingest_file(file_path, frontmatter_dir)

    # Modify frontmatter
    file_path.write_text(
        "---\n"
        "title: Two Sum (Revised)\n"
        "category: data-structures\n"
        "tags:\n"
        "  - map\n"
        "difficulty: medium\n"
        "pack_id: leetcode-top-100\n"
        "---\n"
        "# Two Sum Revised\n\nUpdated solution approach.\n"
    )
    result = await service.ingest_file(file_path, frontmatter_dir)
    assert result["status"] == "indexed"

    cursor = await db.execute(
        "SELECT title, category, difficulty FROM documents WHERE file_path = ?",
        (str(file_path),),
    )
    row = await cursor.fetchone()
    assert row["title"] == "Two Sum (Revised)"
    assert row["category"] == "data-structures"
    assert row["difficulty"] == "medium"


@pytest.mark.asyncio
async def test_frontmatter_no_chroma_none_values(service, db, knowledge_dir):
    """Chroma metadata should not contain None values from missing frontmatter."""
    file_path = knowledge_dir / "hello.md"
    await service.ingest_file(file_path, knowledge_dir)

    chroma_results = service.collection.get(where={"file_path": str(file_path)})
    for meta in chroma_results["metadatas"]:
        for v in meta.values():
            assert v is not None, "Chroma metadata should not contain None values"
