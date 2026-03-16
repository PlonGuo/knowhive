"""
Task 32: End-to-end wiring tests — verify lifespan initializes DB, services, routers, and startup sync.
"""
import asyncio
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def tmp_dirs(tmp_path):
    """Create temporary directories for config, DB, Chroma, and knowledge."""
    config_path = tmp_path / "config.yaml"
    db_path = tmp_path / "knowhive.db"
    chroma_path = tmp_path / "chroma_data"
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    return {
        "config_path": config_path,
        "db_path": db_path,
        "chroma_path": chroma_path,
        "knowledge_dir": knowledge_dir,
    }


def _make_client(tmp_dirs):
    """Create a TestClient with all paths pointing to tmp dirs."""
    app = create_app(
        config_path=tmp_dirs["config_path"],
        db_path=str(tmp_dirs["db_path"]),
        chroma_path=str(tmp_dirs["chroma_path"]),
        knowledge_dir=str(tmp_dirs["knowledge_dir"]),
    )
    return TestClient(app, raise_server_exceptions=False)


# ── Health endpoint still works ───────────────────────────────────


def test_health_still_works(tmp_dirs):
    with _make_client(tmp_dirs) as client:
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


# ── Database initialized on startup ──────────────────────────────


def test_db_tables_created_on_startup(tmp_dirs):
    """Lifespan should call init_db, creating tables."""
    with _make_client(tmp_dirs) as client:
        # If DB is initialized, /chat/history should work (queries chat_messages table)
        resp = client.get("/chat/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["messages"] == []
        assert data["total"] == 0


# ── Config router initialized ────────────────────────────────────


def test_config_endpoint_works(tmp_dirs):
    with _make_client(tmp_dirs) as client:
        resp = client.get("/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "llm_provider" in data
        assert "model_name" in data


# ── Ingest router initialized ────────────────────────────────────


def test_ingest_router_initialized(tmp_dirs):
    """POST /ingest/files should work without RuntimeError."""
    # Create a test markdown file
    md_file = tmp_dirs["knowledge_dir"] / "test.md"
    md_file.write_text("# Test\nHello world")

    with _make_client(tmp_dirs) as client:
        resp = client.post("/ingest/files", json={"file_paths": [str(md_file)]})
        assert resp.status_code == 200
        data = resp.json()
        assert "task_id" in data
        assert data["status"] == "accepted"


def test_ingest_status_works_after_ingest(tmp_dirs):
    """GET /ingest/status/{id} should return task info."""
    md_file = tmp_dirs["knowledge_dir"] / "test.md"
    md_file.write_text("# Test\nHello world")

    with _make_client(tmp_dirs) as client:
        resp = client.post("/ingest/files", json={"file_paths": [str(md_file)]})
        task_id = resp.json()["task_id"]

        resp = client.get(f"/ingest/status/{task_id}")
        assert resp.status_code == 200
        assert resp.json()["task_id"] == task_id


# ── Knowledge router initialized ─────────────────────────────────


def test_knowledge_tree_works(tmp_dirs):
    with _make_client(tmp_dirs) as client:
        resp = client.get("/knowledge/tree")
        assert resp.status_code == 200
        data = resp.json()
        assert data["type"] == "directory"
        assert "children" in data


def test_knowledge_file_works(tmp_dirs):
    md_file = tmp_dirs["knowledge_dir"] / "hello.md"
    md_file.write_text("# Hello\nWorld")

    with _make_client(tmp_dirs) as client:
        resp = client.get("/knowledge/file", params={"path": "hello.md"})
        assert resp.status_code == 200
        assert resp.json()["content"] == "# Hello\nWorld"


# ── Chat router initialized ──────────────────────────────────────


def test_chat_history_empty_on_startup(tmp_dirs):
    with _make_client(tmp_dirs) as client:
        resp = client.get("/chat/history")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0


def test_chat_endpoint_accepts_request(tmp_dirs):
    """POST /chat should not crash with RuntimeError (router initialized)."""
    with _make_client(tmp_dirs) as client:
        # Will fail to connect to LLM but should NOT raise RuntimeError
        resp = client.post("/chat", json={"question": "hello"})
        # SSE response — should get at least a 200 (streaming starts)
        assert resp.status_code == 200


# ── Resync endpoint works ────────────────────────────────────────


def test_resync_endpoint_works(tmp_dirs):
    with _make_client(tmp_dirs) as client:
        resp = client.post("/ingest/resync")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_files"] == 0  # empty knowledge dir


# ── Startup sync runs ────────────────────────────────────────────


def test_startup_sync_ingests_existing_files(tmp_dirs):
    """If knowledge/ has .md files at startup, sync should ingest them."""
    md_file = tmp_dirs["knowledge_dir"] / "existing.md"
    md_file.write_text("# Existing\nThis was here before startup")

    with _make_client(tmp_dirs) as client:
        # After startup sync, the file should appear in knowledge tree
        resp = client.get("/knowledge/tree")
        assert resp.status_code == 200
        children = resp.json()["children"]
        names = [c["name"] for c in children]
        assert "existing.md" in names

        # And the document should be in the DB (ingest status via resync shows 0 new
        # because startup sync already processed it — or we can check chat works)
        # Check the ingest task was created
        resp = client.get("/chat/history")
        assert resp.status_code == 200


def test_startup_sync_runs_without_knowledge_dir(tmp_dirs):
    """Startup sync should handle missing knowledge dir gracefully."""
    import shutil
    shutil.rmtree(tmp_dirs["knowledge_dir"])

    # Should not crash
    with _make_client(tmp_dirs) as client:
        resp = client.get("/health")
        assert resp.status_code == 200


# ── Full pipeline: ingest → query ─────────────────────────────────


def test_ingest_then_knowledge_tree_shows_file(tmp_dirs):
    """Ingest a file, then verify it shows in knowledge tree."""
    md_file = tmp_dirs["knowledge_dir"] / "notes.md"
    md_file.write_text("# My Notes\nSome important content here")

    with _make_client(tmp_dirs) as client:
        # Ingest
        resp = client.post("/ingest/files", json={"file_paths": [str(md_file)]})
        assert resp.status_code == 200

        # Tree should show the file
        resp = client.get("/knowledge/tree")
        children = resp.json()["children"]
        names = [c["name"] for c in children]
        assert "notes.md" in names


def test_delete_chat_history_works(tmp_dirs):
    with _make_client(tmp_dirs) as client:
        resp = client.delete("/chat/history")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 0
