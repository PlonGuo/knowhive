"""Integration tests: ingest leetcode-basics pack → verify 25 files, heading chunks, pack_id filter, frontmatter (Task 119)."""

import shutil
from pathlib import Path

import pytest
import pytest_asyncio

from app.database import init_db, close_db, get_db
from app.services.ingest_service import IngestService
from app.services.rag_service import RAGService

LEETCODE_PACK_DIR = Path(__file__).parent.parent / "knowledge" / "leetcode-basics"


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
    """Copy leetcode-basics pack into a temp knowledge directory."""
    kdir = tmp_path / "knowledge"
    shutil.copytree(LEETCODE_PACK_DIR, kdir)
    return kdir


@pytest.fixture
def ingest_service(chroma_dir):
    return IngestService(chroma_path=chroma_dir, collection_name="test_leetcode")


@pytest.fixture
def rag_service(ingest_service):
    return RAGService(collection=ingest_service.collection)


@pytest_asyncio.fixture
async def ingested(db, ingest_service, knowledge_dir):
    """Ingest all leetcode-basics .md files and return results."""
    results = await ingest_service.ingest_directory(knowledge_dir)
    return results


# ── File Count ────────────────────────────────────────────────


class TestFileCount:
    """Verify all 25 leetcode-basics files are indexed."""

    @pytest.mark.asyncio
    async def test_25_files_indexed(self, ingested, knowledge_dir):
        md_files = list(knowledge_dir.rglob("*.md"))
        indexed = [r for r in ingested if r["status"] == "indexed"]
        assert len(indexed) == len(md_files)
        assert len(indexed) == 25, f"Expected 25 files, got {len(indexed)}"

    @pytest.mark.asyncio
    async def test_no_errors(self, ingested):
        errors = [r for r in ingested if r["status"] == "error"]
        assert errors == [], f"Ingest errors: {errors}"

    @pytest.mark.asyncio
    async def test_each_file_has_chunks(self, ingested):
        for r in ingested:
            assert r["chunk_count"] > 0, f"{r['file_path']} has 0 chunks"


# ── Frontmatter in SQLite ────────────────────────────────────


class TestFrontmatterInDB:
    """Verify frontmatter fields stored in SQLite."""

    @pytest.mark.asyncio
    async def test_titles_stored(self, ingested):
        async with get_db() as conn:
            cursor = await conn.execute("SELECT title FROM documents WHERE title IS NOT NULL")
            rows = await cursor.fetchall()
        assert len(rows) >= 20, f"Expected >=20 titles, got {len(rows)}"

    @pytest.mark.asyncio
    async def test_categories_stored(self, ingested):
        async with get_db() as conn:
            cursor = await conn.execute("SELECT DISTINCT category FROM documents WHERE category IS NOT NULL")
            rows = await cursor.fetchall()
        categories = {r["category"] for r in rows}
        assert len(categories) >= 4, f"Expected >=4 categories, got {categories}"

    @pytest.mark.asyncio
    async def test_difficulty_values(self, ingested):
        async with get_db() as conn:
            cursor = await conn.execute("SELECT DISTINCT difficulty FROM documents WHERE difficulty IS NOT NULL")
            rows = await cursor.fetchall()
        difficulties = {r["difficulty"] for r in rows}
        assert difficulties <= {"easy", "medium", "hard"}
        assert len(difficulties) >= 2, f"Expected >=2 difficulties, got {difficulties}"

    @pytest.mark.asyncio
    async def test_pack_id_is_leetcode_basics(self, ingested):
        async with get_db() as conn:
            cursor = await conn.execute("SELECT pack_id FROM documents WHERE pack_id IS NOT NULL")
            rows = await cursor.fetchall()
        pack_ids = {r["pack_id"] for r in rows}
        assert pack_ids == {"leetcode-basics"}, f"Expected leetcode-basics, got {pack_ids}"

    @pytest.mark.asyncio
    async def test_tags_stored(self, ingested):
        async with get_db() as conn:
            cursor = await conn.execute("SELECT tags FROM documents WHERE tags IS NOT NULL")
            rows = await cursor.fetchall()
        assert len(rows) >= 20, f"Expected >=20 docs with tags"


# ── Heading-Aware Chunking ────────────────────────────────────


class TestHeadingChunks:
    """Verify heading-aware chunking produces expected metadata."""

    @pytest.mark.asyncio
    async def test_section_heading_metadata(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        headings = [
            m.get("section_heading")
            for m in all_chunks["metadatas"]
            if m.get("section_heading")
        ]
        assert len(headings) > 0, "Expected section_heading metadata"

    @pytest.mark.asyncio
    async def test_chunk_index_metadata(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        for meta in all_chunks["metadatas"]:
            assert "chunk_index" in meta, f"Missing chunk_index in {meta}"

    @pytest.mark.asyncio
    async def test_algorithm_docs_have_multiple_chunks(self, ingested, ingest_service):
        """Algorithm docs with many headings should produce multiple chunks."""
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        by_file: dict[str, int] = {}
        for meta in all_chunks["metadatas"]:
            fp = meta["file_path"]
            by_file[fp] = by_file.get(fp, 0) + 1
        multi_chunk_files = [fp for fp, count in by_file.items() if count > 1]
        assert len(multi_chunk_files) >= 10, (
            f"Expected >=10 files with multiple chunks, got {len(multi_chunk_files)}"
        )


# ── Pack ID Filter ────────────────────────────────────────────


class TestPackIdFilter:
    """Verify pack_id Chroma metadata filter works."""

    @pytest.mark.asyncio
    async def test_retrieve_with_pack_id(self, ingested, rag_service):
        chunks = rag_service.retrieve(
            "Dijkstra shortest path", k=5, where={"pack_id": "leetcode-basics"}
        )
        assert len(chunks) > 0

    @pytest.mark.asyncio
    async def test_retrieve_without_filter(self, ingested, rag_service):
        chunks = rag_service.retrieve("dynamic programming", k=5)
        assert len(chunks) > 0

    @pytest.mark.asyncio
    async def test_nonexistent_pack_empty(self, ingested, rag_service):
        chunks = rag_service.retrieve(
            "algorithm", k=5, where={"pack_id": "does-not-exist"}
        )
        assert len(chunks) == 0

    @pytest.mark.asyncio
    async def test_pack_id_in_chunk_metadata(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        pack_ids = {m.get("pack_id") for m in all_chunks["metadatas"]}
        assert "leetcode-basics" in pack_ids


# ── Frontmatter in Chroma ────────────────────────────────────


class TestFrontmatterInChroma:
    """Verify frontmatter fields in Chroma chunk metadata."""

    @pytest.mark.asyncio
    async def test_category_in_chroma(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        categories = {m.get("category") for m in all_chunks["metadatas"] if m.get("category")}
        assert len(categories) >= 4

    @pytest.mark.asyncio
    async def test_difficulty_in_chroma(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        difficulties = {m.get("difficulty") for m in all_chunks["metadatas"] if m.get("difficulty")}
        assert difficulties <= {"easy", "medium", "hard"}
        assert len(difficulties) >= 2

    @pytest.mark.asyncio
    async def test_title_in_chroma(self, ingested, ingest_service):
        all_chunks = ingest_service.collection.get(include=["metadatas"])
        titles = {m.get("title") for m in all_chunks["metadatas"] if m.get("title")}
        assert len(titles) >= 20, f"Expected >=20 titles in Chroma, got {len(titles)}"
