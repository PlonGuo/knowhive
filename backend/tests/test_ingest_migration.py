"""Tests for Task 110 — Re-ingest migration: chunk_strategy column + POST /ingest/migrate."""
import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.database import close_db, get_db, init_db
from app.main import create_app


@pytest_asyncio.fixture
async def db():
    """In-memory database for testing."""
    await init_db(":memory:")
    async with get_db() as conn:
        yield conn
    await close_db()


@pytest.fixture
def knowledge_dir(tmp_path):
    """Create a knowledge directory with sample Markdown files."""
    md1 = tmp_path / "hello.md"
    md1.write_text("# Hello World\n\nThis is a test document with enough content.\n")

    md2 = tmp_path / "notes.md"
    md2.write_text("# Notes\n\nSome notes here.\n\n## Section Two\n\nMore content.\n")

    return tmp_path


@pytest.fixture
def chroma_dir(tmp_path):
    """Separate temp dir for Chroma persistence."""
    d = tmp_path / "chroma_store"
    d.mkdir()
    return d


@pytest.fixture
def app(db, chroma_dir, knowledge_dir, tmp_path):
    """Create a FastAPI test app with ingest router configured."""
    config_path = tmp_path / "config.yaml"
    application = create_app(config_path=config_path)

    from app.routers.ingest import init_ingest_router

    init_ingest_router(
        chroma_path=str(chroma_dir),
        knowledge_dir=str(knowledge_dir),
    )

    return application


@pytest.fixture
def client(app):
    return TestClient(app)


# ── chunk_strategy column exists ──────────────────────────────────


@pytest.mark.asyncio
async def test_chunk_strategy_column_exists(db):
    """Documents table should have a chunk_strategy column."""
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = {row[1] for row in await cursor.fetchall()}
    assert "chunk_strategy" in columns


@pytest.mark.asyncio
async def test_chunk_strategy_default_null(db):
    """chunk_strategy should default to NULL for new rows."""
    await db.execute(
        """INSERT INTO documents (file_path, file_name, modified_at)
           VALUES ('test.md', 'test.md', '2026-01-01T00:00:00')"""
    )
    await db.commit()
    cursor = await db.execute(
        "SELECT chunk_strategy FROM documents WHERE file_path = 'test.md'"
    )
    row = await cursor.fetchone()
    assert row["chunk_strategy"] is None


# ── chunk_strategy set on ingest ──────────────────────────────────


@pytest.mark.asyncio
async def test_ingest_md_sets_heading_strategy(client, db, knowledge_dir):
    """Ingesting a .md file should set chunk_strategy to 'heading-aware'."""
    resp = client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )
    assert resp.status_code == 200

    cursor = await db.execute(
        "SELECT chunk_strategy FROM documents WHERE file_name = 'hello.md'"
    )
    row = await cursor.fetchone()
    assert row["chunk_strategy"] == "heading-aware"


@pytest.mark.asyncio
async def test_ingest_pdf_sets_fixed_strategy(client, db, tmp_path, chroma_dir):
    """Ingesting a .pdf file should set chunk_strategy to 'fixed-split'."""
    import fitz

    pdf_path = tmp_path / "knowledge" / "report.pdf"
    pdf_path.parent.mkdir(exist_ok=True)
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "PDF report content for testing migration.")
    doc.save(str(pdf_path))
    doc.close()

    # Re-init router with knowledge dir containing PDF
    from app.routers.ingest import init_ingest_router
    init_ingest_router(
        chroma_path=str(chroma_dir),
        knowledge_dir=str(pdf_path.parent),
    )

    resp = client.post(
        "/ingest/files",
        json={"file_paths": [str(pdf_path)]},
    )
    assert resp.status_code == 200

    cursor = await db.execute(
        "SELECT chunk_strategy FROM documents WHERE file_name = 'report.pdf'"
    )
    row = await cursor.fetchone()
    assert row["chunk_strategy"] == "fixed-split"


# ── POST /ingest/migrate endpoint ────────────────────────────────


@pytest.mark.asyncio
async def test_migrate_endpoint_exists(client):
    """POST /ingest/migrate should return 200."""
    resp = client.post("/ingest/migrate")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_migrate_returns_task_response(client):
    """POST /ingest/migrate should return task_id and status."""
    resp = client.post("/ingest/migrate")
    data = resp.json()
    assert "task_id" in data
    assert data["status"] == "accepted"
    assert "total_files" in data


@pytest.mark.asyncio
async def test_migrate_reingests_null_strategy_docs(client, db, knowledge_dir):
    """POST /ingest/migrate should re-ingest docs with NULL chunk_strategy."""
    # First ingest files normally (they will get chunk_strategy set)
    client.post(
        "/ingest/files",
        json={"file_paths": [
            str(knowledge_dir / "hello.md"),
            str(knowledge_dir / "notes.md"),
        ]},
    )

    # Simulate old docs by setting chunk_strategy to NULL
    await db.execute("UPDATE documents SET chunk_strategy = NULL")
    await db.commit()

    # Run migration
    resp = client.post("/ingest/migrate")
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_files"] == 2

    # Verify chunk_strategy is now set
    cursor = await db.execute(
        "SELECT chunk_strategy FROM documents WHERE chunk_strategy IS NOT NULL"
    )
    rows = await cursor.fetchall()
    assert len(rows) == 2


@pytest.mark.asyncio
async def test_migrate_skips_already_migrated_docs(client, db, knowledge_dir):
    """POST /ingest/migrate should only re-ingest docs with NULL chunk_strategy."""
    # Ingest both files (they get chunk_strategy set)
    client.post(
        "/ingest/files",
        json={"file_paths": [
            str(knowledge_dir / "hello.md"),
            str(knowledge_dir / "notes.md"),
        ]},
    )

    # Set only one to NULL
    await db.execute(
        "UPDATE documents SET chunk_strategy = NULL WHERE file_name = 'hello.md'"
    )
    await db.commit()

    resp = client.post("/ingest/migrate")
    data = resp.json()
    assert data["total_files"] == 1


@pytest.mark.asyncio
async def test_migrate_no_docs_to_migrate(client, db, knowledge_dir):
    """POST /ingest/migrate with all docs already migrated should report 0 files."""
    # Ingest files — they already have chunk_strategy set
    client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )

    resp = client.post("/ingest/migrate")
    data = resp.json()
    assert data["total_files"] == 0


@pytest.mark.asyncio
async def test_migrate_updates_chunk_strategy_to_heading_aware(client, db, knowledge_dir):
    """After migration, .md files should have chunk_strategy='heading-aware'."""
    client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "notes.md")]},
    )

    # Simulate old doc
    await db.execute("UPDATE documents SET chunk_strategy = NULL")
    await db.commit()

    client.post("/ingest/migrate")

    cursor = await db.execute(
        "SELECT chunk_strategy FROM documents WHERE file_name = 'notes.md'"
    )
    row = await cursor.fetchone()
    assert row["chunk_strategy"] == "heading-aware"


@pytest.mark.asyncio
async def test_migrate_task_completes_successfully(client, db, knowledge_dir):
    """Migration task should complete with status 'completed'."""
    client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )

    # Simulate old doc
    await db.execute("UPDATE documents SET chunk_strategy = NULL")
    await db.commit()

    resp = client.post("/ingest/migrate")
    task_id = resp.json()["task_id"]

    status_resp = client.get(f"/ingest/status/{task_id}")
    data = status_resp.json()
    assert data["status"] == "completed"
    assert data["processed_files"] == 1


# ── Model tests ──────────────────────────────────────────────────


def test_document_create_has_chunk_strategy():
    """DocumentCreate should accept chunk_strategy field."""
    from app.models import DocumentCreate
    doc = DocumentCreate(
        file_path="test.md",
        file_name="test.md",
        modified_at="2026-01-01",
        chunk_strategy="heading-aware",
    )
    assert doc.chunk_strategy == "heading-aware"


def test_document_create_chunk_strategy_default_none():
    """DocumentCreate chunk_strategy should default to None."""
    from app.models import DocumentCreate
    doc = DocumentCreate(
        file_path="test.md",
        file_name="test.md",
        modified_at="2026-01-01",
    )
    assert doc.chunk_strategy is None


def test_document_model_has_chunk_strategy():
    """Document model should have chunk_strategy field."""
    from app.models import Document
    doc = Document(
        id=1,
        file_path="test.md",
        file_name="test.md",
        modified_at="2026-01-01",
        chunk_strategy="fixed-split",
        created_at="2026-01-01",
        updated_at="2026-01-01",
    )
    assert doc.chunk_strategy == "fixed-split"


# ── Migration column migration (ALTER TABLE) ─────────────────────


@pytest.mark.asyncio
async def test_migration_adds_chunk_strategy_column(tmp_path):
    """init_db should add chunk_strategy column to existing documents table via migration."""
    db_path = str(tmp_path / "test_migrate.db")

    # Create DB without chunk_strategy (simulate old schema)
    import aiosqlite
    conn = await aiosqlite.connect(db_path)
    await conn.execute("""
        CREATE TABLE documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            file_path TEXT NOT NULL UNIQUE,
            file_name TEXT NOT NULL,
            modified_at TEXT NOT NULL
        )
    """)
    await conn.commit()
    await conn.close()

    # Re-init with migration
    await init_db(db_path)

    async with get_db() as db:
        cursor = await db.execute("PRAGMA table_info(documents)")
        columns = {row[1] for row in await cursor.fetchall()}
        assert "chunk_strategy" in columns

    await close_db()
