"""Tests for startup sync service — scan knowledge/, diff with DB, re-embed changes."""
import pytest
import pytest_asyncio

from app.database import close_db, get_db, init_db
from app.services.ingest_service import IngestService
from app.services.sync_service import SyncService


@pytest.fixture
def knowledge_dir(tmp_path):
    """Create a temporary knowledge directory with sample Markdown files."""
    md1 = tmp_path / "hello.md"
    md1.write_text("# Hello World\n\nThis is a test document about greetings.\n")

    md2 = tmp_path / "subdir" / "nested.md"
    md2.parent.mkdir()
    md2.write_text("# Nested\n\nA nested markdown file with some content.\n")

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
def ingest_service(db, chroma_dir):
    """Create an IngestService with test Chroma dir."""
    return IngestService(chroma_path=str(chroma_dir))


@pytest.fixture
def sync_service(ingest_service, knowledge_dir):
    """Create a SyncService with test IngestService and knowledge dir."""
    return SyncService(ingest_service=ingest_service, knowledge_dir=knowledge_dir)


# ── Scan & diff ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_sync_new_files(sync_service, db, knowledge_dir):
    """First sync should ingest all files as new."""
    result = await sync_service.sync()

    assert result["new"] == 2
    assert result["modified"] == 0
    assert result["deleted"] == 0

    # Verify DB records created
    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 2


@pytest.mark.asyncio
async def test_sync_no_changes(sync_service, db, knowledge_dir):
    """Second sync with no changes should detect nothing new."""
    await sync_service.sync()
    result = await sync_service.sync()

    assert result["new"] == 0
    assert result["modified"] == 0
    assert result["deleted"] == 0


@pytest.mark.asyncio
async def test_sync_modified_file(sync_service, db, knowledge_dir):
    """Modifying a file should trigger re-embed on next sync."""
    await sync_service.sync()

    # Modify a file
    (knowledge_dir / "hello.md").write_text("# Updated\n\nCompletely new content.\n")

    result = await sync_service.sync()
    assert result["new"] == 0
    assert result["modified"] == 1
    assert result["deleted"] == 0

    # Verify DB record updated
    cursor = await db.execute(
        "SELECT file_hash FROM documents WHERE file_path = ?",
        (str(knowledge_dir / "hello.md"),),
    )
    row = await cursor.fetchone()
    assert row["file_hash"] is not None


@pytest.mark.asyncio
async def test_sync_deleted_file(sync_service, db, knowledge_dir, ingest_service):
    """Deleting a file should remove DB record and Chroma vectors on next sync."""
    await sync_service.sync()

    # Delete a file
    (knowledge_dir / "hello.md").unlink()

    result = await sync_service.sync()
    assert result["new"] == 0
    assert result["modified"] == 0
    assert result["deleted"] == 1

    # Verify DB record removed
    cursor = await db.execute(
        "SELECT COUNT(*) as cnt FROM documents WHERE file_path = ?",
        (str(knowledge_dir / "hello.md"),),
    )
    row = await cursor.fetchone()
    assert row["cnt"] == 0

    # Verify Chroma chunks removed
    chroma_results = ingest_service.collection.get(
        where={"file_path": str(knowledge_dir / "hello.md")}
    )
    assert len(chroma_results["ids"]) == 0


@pytest.mark.asyncio
async def test_sync_added_file(sync_service, db, knowledge_dir):
    """Adding a new file after initial sync should be detected."""
    await sync_service.sync()

    # Add a new file
    (knowledge_dir / "new_doc.md").write_text("# New Doc\n\nBrand new content.\n")

    result = await sync_service.sync()
    assert result["new"] == 1
    assert result["modified"] == 0
    assert result["deleted"] == 0

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 3


@pytest.mark.asyncio
async def test_sync_mixed_changes(sync_service, db, knowledge_dir):
    """Sync should handle new, modified, and deleted files in one pass."""
    await sync_service.sync()

    # Modify one file
    (knowledge_dir / "hello.md").write_text("# Modified\n\nChanged content.\n")
    # Delete another
    (knowledge_dir / "subdir" / "nested.md").unlink()
    # Add a new one
    (knowledge_dir / "extra.md").write_text("# Extra\n\nExtra content.\n")

    result = await sync_service.sync()
    assert result["new"] == 1
    assert result["modified"] == 1
    assert result["deleted"] == 1

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 2  # original 2 - 1 deleted + 1 new = 2


@pytest.mark.asyncio
async def test_sync_empty_directory(sync_service, db, knowledge_dir):
    """Syncing an empty directory should work without errors."""
    # Remove all files
    for f in knowledge_dir.rglob("*.md"):
        f.unlink()

    result = await sync_service.sync()
    assert result["new"] == 0
    assert result["modified"] == 0
    assert result["deleted"] == 0


@pytest.mark.asyncio
async def test_sync_deletes_all_after_files_removed(sync_service, db, knowledge_dir):
    """Removing all files after sync should delete all DB records."""
    await sync_service.sync()

    # Remove all files
    for f in knowledge_dir.rglob("*.md"):
        f.unlink()

    result = await sync_service.sync()
    assert result["deleted"] == 2

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 0


@pytest.mark.asyncio
async def test_sync_returns_errors_list(sync_service, db, knowledge_dir):
    """Sync result should include an errors list."""
    result = await sync_service.sync()
    assert "errors" in result
    assert isinstance(result["errors"], list)
