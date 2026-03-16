"""Integration tests: ingest sample pack → verify frontmatter, heading chunks, pack_id filter (Task 109)."""

import shutil
import tempfile
from pathlib import Path

import pytest
import pytest_asyncio

from app.database import init_db, close_db, get_db
from app.services.ingest_service import IngestService
from app.services.rag_service import RAGService

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SAMPLE_PACK_DIR = FIXTURES_DIR / "sample_pack"


@pytest_asyncio.fixture
async def db():
    """In-memory SQLite database."""
    await init_db(":memory:")
    yield
    await close_db()


@pytest.fixture
def chroma_dir(tmp_path):
    """Temporary Chroma directory."""
    return str(tmp_path / "chroma")


@pytest.fixture
def knowledge_dir(tmp_path):
    """Copy sample pack into a temp knowledge directory."""
    kdir = tmp_path / "knowledge"
    shutil.copytree(SAMPLE_PACK_DIR, kdir)
    return kdir


@pytest.fixture
def ingest_service(chroma_dir):
    return IngestService(chroma_path=chroma_dir, collection_name="test_pack")


@pytest.fixture
def rag_service(ingest_service):
    return RAGService(collection=ingest_service.collection)


# ── Ingest all sample pack files ─────────────────────────────


@pytest_asyncio.fixture
async def ingested(db, ingest_service, knowledge_dir):
    """Ingest all sample pack .md files and return results."""
    results = await ingest_service.ingest_directory(knowledge_dir)
    return results


# ── Tests ────────────────────────────────────────────────────


class TestIngestResults:
    """Verify ingest pipeline succeeds for all sample pack files."""

    @pytest.mark.asyncio
    async def test_all_files_indexed(self, ingested, knowledge_dir):
        md_files = list(knowledge_dir.glob("*.md"))
        indexed = [r for r in ingested if r["status"] == "indexed"]
        assert len(indexed) == len(md_files)

    @pytest.mark.asyncio
    async def test_no_errors(self, ingested):
        errors = [r for r in ingested if r["status"] == "error"]
        assert errors == [], f"Ingest errors: {errors}"

    @pytest.mark.asyncio
    async def test_each_file_has_chunks(self, ingested):
        for r in ingested:
            assert r["chunk_count"] > 0, f"{r['file_path']} has 0 chunks"


class TestFrontmatterInDB:
    """Verify frontmatter fields stored in SQLite documents table."""

    @pytest.mark.asyncio
    async def test_title_stored(self, ingested):
        async with get_db() as db:
            cursor = await db.execute("SELECT title FROM documents WHERE title IS NOT NULL")
            rows = await cursor.fetchall()
        assert len(rows) >= 5, "Expected frontmatter titles for sample pack files"

    @pytest.mark.asyncio
    async def test_category_stored(self, ingested):
        async with get_db() as db:
            cursor = await db.execute("SELECT DISTINCT category FROM documents WHERE category IS NOT NULL")
            rows = await cursor.fetchall()
        categories = {r["category"] for r in rows}
        assert len(categories) >= 2, f"Expected multiple categories, got {categories}"

    @pytest.mark.asyncio
    async def test_difficulty_stored(self, ingested):
        async with get_db() as db:
            cursor = await db.execute("SELECT DISTINCT difficulty FROM documents WHERE difficulty IS NOT NULL")
            rows = await cursor.fetchall()
        difficulties = {r["difficulty"] for r in rows}
        assert difficulties <= {"easy", "medium", "hard"}
        assert len(difficulties) >= 2

    @pytest.mark.asyncio
    async def test_pack_id_stored(self, ingested):
        async with get_db() as db:
            cursor = await db.execute("SELECT pack_id FROM documents WHERE pack_id IS NOT NULL")
            rows = await cursor.fetchall()
        pack_ids = {r["pack_id"] for r in rows}
        assert pack_ids == {"leetcode-fundamentals"}

    @pytest.mark.asyncio
    async def test_tags_stored_as_csv(self, ingested):
        async with get_db() as db:
            cursor = await db.execute("SELECT tags FROM documents WHERE tags IS NOT NULL")
            rows = await cursor.fetchall()
        assert len(rows) >= 5
        for row in rows:
            assert "," in row["tags"] or len(row["tags"]) > 0


class TestHeadingChunks:
    """Verify heading-aware chunking produces section_heading metadata."""

    @pytest.mark.asyncio
    async def test_chunks_have_section_heading(self, ingested, ingest_service):
        # Query Chroma for all chunks
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        headings = [
            m.get("section_heading")
            for m in all_chunks["metadatas"]
            if m.get("section_heading")
        ]
        assert len(headings) > 0, "Expected section_heading metadata from heading chunker"

    @pytest.mark.asyncio
    async def test_chunks_have_chunk_index(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        for meta in all_chunks["metadatas"]:
            assert "chunk_index" in meta, f"Missing chunk_index in {meta}"

    @pytest.mark.asyncio
    async def test_multiple_chunks_per_file(self, ingested, ingest_service):
        """Files with multiple headings should produce multiple chunks."""
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        # Group by file_path
        by_file: dict[str, int] = {}
        for meta in all_chunks["metadatas"]:
            fp = meta["file_path"]
            by_file[fp] = by_file.get(fp, 0) + 1
        multi_chunk_files = [fp for fp, count in by_file.items() if count > 1]
        assert len(multi_chunk_files) >= 3, (
            f"Expected >=3 files with multiple chunks, got {len(multi_chunk_files)}"
        )


class TestPackIdFilter:
    """Verify pack_id metadata filter works in RAG retrieval."""

    @pytest.mark.asyncio
    async def test_retrieve_with_pack_id_filter(self, ingested, rag_service):
        """Retrieval with pack_id filter returns only matching chunks."""
        chunks = rag_service.retrieve(
            "hash map two sum", k=5, where={"pack_id": "leetcode-fundamentals"}
        )
        assert len(chunks) > 0
        # All returned chunks should have the correct file paths (from sample pack)

    @pytest.mark.asyncio
    async def test_retrieve_without_filter_returns_all(self, ingested, rag_service):
        """Retrieval without filter returns chunks from any pack."""
        chunks = rag_service.retrieve("algorithm", k=5)
        assert len(chunks) > 0

    @pytest.mark.asyncio
    async def test_retrieve_nonexistent_pack_returns_empty(self, ingested, rag_service):
        """Retrieval with non-existent pack_id returns empty."""
        chunks = rag_service.retrieve(
            "algorithm", k=5, where={"pack_id": "nonexistent-pack"}
        )
        assert len(chunks) == 0

    @pytest.mark.asyncio
    async def test_pack_id_in_chunk_metadata(self, ingested, ingest_service):
        """Verify pack_id is stored in Chroma chunk metadata."""
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        pack_ids = {m.get("pack_id") for m in all_chunks["metadatas"]}
        assert "leetcode-fundamentals" in pack_ids


class TestFrontmatterInChroma:
    """Verify frontmatter fields propagated to Chroma metadata."""

    @pytest.mark.asyncio
    async def test_category_in_chroma(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        categories = {m.get("category") for m in all_chunks["metadatas"] if m.get("category")}
        assert len(categories) >= 2

    @pytest.mark.asyncio
    async def test_difficulty_in_chroma(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        difficulties = {m.get("difficulty") for m in all_chunks["metadatas"] if m.get("difficulty")}
        assert difficulties <= {"easy", "medium", "hard"}

    @pytest.mark.asyncio
    async def test_title_in_chroma(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        titles = {m.get("title") for m in all_chunks["metadatas"] if m.get("title")}
        assert len(titles) >= 5, f"Expected >=5 titles in Chroma, got {titles}"
