"""Tests for ingest API endpoints — POST /ingest/files, GET /ingest/status, POST /ingest/resync."""
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
    """Create a temporary knowledge directory with sample Markdown files."""
    md1 = tmp_path / "hello.md"
    md1.write_text("# Hello World\n\nThis is a test document.\n")

    md2 = tmp_path / "subdir" / "nested.md"
    md2.parent.mkdir()
    md2.write_text("# Nested\n\nA nested markdown file.\n")

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

    # Import and configure ingest router
    from app.routers.ingest import init_ingest_router

    init_ingest_router(
        chroma_path=str(chroma_dir),
        knowledge_dir=str(knowledge_dir),
    )

    return application


@pytest.fixture
def client(app):
    """TestClient for the FastAPI app."""
    return TestClient(app)


# ── POST /ingest/files ────────────────────────────────────────────


def test_ingest_files_returns_task_id(client, knowledge_dir):
    """POST /ingest/files with file paths should return a task_id."""
    resp = client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "task_id" in data
    assert data["status"] == "accepted"
    assert data["total_files"] == 1


def test_ingest_files_multiple(client, knowledge_dir):
    """POST /ingest/files with multiple file paths."""
    resp = client.post(
        "/ingest/files",
        json={
            "file_paths": [
                str(knowledge_dir / "hello.md"),
                str(knowledge_dir / "subdir" / "nested.md"),
            ]
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["total_files"] == 2


def test_ingest_files_empty_list(client):
    """POST /ingest/files with empty list should return 422."""
    resp = client.post("/ingest/files", json={"file_paths": []})
    assert resp.status_code == 422


def test_ingest_files_no_body(client):
    """POST /ingest/files with no body should return 422."""
    resp = client.post("/ingest/files")
    assert resp.status_code == 422


# ── GET /ingest/status/{task_id} ──────────────────────────────────


def test_ingest_status_after_submit(client, knowledge_dir):
    """GET /ingest/status/{id} should return task progress."""
    # Submit first
    resp = client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )
    task_id = resp.json()["task_id"]

    # Check status — task runs synchronously in test client
    status_resp = client.get(f"/ingest/status/{task_id}")
    assert status_resp.status_code == 200
    data = status_resp.json()
    assert data["task_id"] == task_id
    assert data["status"] in ("pending", "running", "completed", "failed")
    assert "total_files" in data
    assert "processed_files" in data


def test_ingest_status_completed(client, knowledge_dir):
    """After sync ingest completes, status should be 'completed'."""
    resp = client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )
    task_id = resp.json()["task_id"]

    status_resp = client.get(f"/ingest/status/{task_id}")
    data = status_resp.json()
    assert data["status"] == "completed"
    assert data["processed_files"] == 1


def test_ingest_status_not_found(client):
    """GET /ingest/status with unknown task_id should return 404."""
    resp = client.get(f"/ingest/status/{uuid.uuid4()}")
    assert resp.status_code == 404


# ── POST /ingest/resync ──────────────────────────────────────────


def test_resync_returns_task_id(client, knowledge_dir):
    """POST /ingest/resync should re-ingest all files and return a task_id."""
    resp = client.post("/ingest/resync")
    assert resp.status_code == 200
    data = resp.json()
    assert "task_id" in data
    assert data["status"] == "accepted"
    assert data["total_files"] >= 0


def test_resync_ingests_all_knowledge_files(client, knowledge_dir):
    """POST /ingest/resync should ingest all .md files in knowledge dir."""
    resp = client.post("/ingest/resync")
    task_id = resp.json()["task_id"]

    status_resp = client.get(f"/ingest/status/{task_id}")
    data = status_resp.json()
    assert data["status"] == "completed"
    # knowledge_dir has 2 .md files
    assert data["total_files"] == 2
    assert data["processed_files"] == 2


# ── Integration: ingest then verify DB ───────────────────────────


@pytest.mark.asyncio
async def test_ingest_creates_db_records(client, db, knowledge_dir):
    """After ingesting files via API, documents should appear in the database."""
    client.post(
        "/ingest/files",
        json={
            "file_paths": [
                str(knowledge_dir / "hello.md"),
                str(knowledge_dir / "subdir" / "nested.md"),
            ]
        },
    )

    cursor = await db.execute("SELECT COUNT(*) as cnt FROM documents")
    row = await cursor.fetchone()
    assert row["cnt"] == 2


@pytest.mark.asyncio
async def test_ingest_creates_task_record(client, db, knowledge_dir):
    """After submitting ingest, an ingest_tasks record should exist in DB."""
    resp = client.post(
        "/ingest/files",
        json={"file_paths": [str(knowledge_dir / "hello.md")]},
    )
    task_id = resp.json()["task_id"]

    cursor = await db.execute("SELECT * FROM ingest_tasks WHERE id = ?", (task_id,))
    row = await cursor.fetchone()
    assert row is not None
    assert row["status"] == "completed"
    assert row["total_files"] == 1
    assert row["processed_files"] == 1
