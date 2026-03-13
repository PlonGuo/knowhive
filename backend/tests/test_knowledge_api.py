"""Tests for knowledge API endpoints — GET /knowledge/tree, GET /knowledge/file, DELETE /knowledge/file."""
from pathlib import Path

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.database import close_db, get_db, init_db
from app.main import create_app
from app.services.ingest_service import IngestService


@pytest_asyncio.fixture
async def db():
    """In-memory database for testing."""
    await init_db(":memory:")
    yield
    await close_db()


@pytest.fixture
def knowledge_dir(tmp_path):
    """Create a temporary knowledge directory with sample Markdown files."""
    # Root-level file
    (tmp_path / "readme.md").write_text("# Readme\n\nTop-level doc.\n")

    # Subdirectory with files
    sub = tmp_path / "guides"
    sub.mkdir()
    (sub / "getting-started.md").write_text("# Getting Started\n\nStep 1.\n")
    (sub / "advanced.md").write_text("# Advanced\n\nDeep dive.\n")

    # Nested subdirectory
    deep = sub / "extras"
    deep.mkdir()
    (deep / "tips.md").write_text("# Tips\n\nUseful tips.\n")

    # Non-markdown file (should still appear in tree)
    (tmp_path / "notes.txt").write_text("plain text notes")

    return tmp_path


@pytest.fixture
def chroma_dir(tmp_path):
    """Temporary directory for Chroma data."""
    p = tmp_path / "chroma_test"
    p.mkdir()
    return str(p)


@pytest.fixture
def ingest_service(chroma_dir):
    """Create an IngestService for testing."""
    return IngestService(chroma_path=chroma_dir)


@pytest.fixture
def app(db, knowledge_dir, chroma_dir, ingest_service, tmp_path):
    """Create a FastAPI test app with knowledge router configured."""
    config_path = tmp_path / "config.yaml"
    application = create_app(config_path=config_path)

    from app.routers.knowledge import init_knowledge_router

    init_knowledge_router(knowledge_dir=str(knowledge_dir), ingest_service=ingest_service)

    return application


@pytest.fixture
def client(app):
    return TestClient(app)


# ── GET /knowledge/tree ──────────────────────────────────────────


def test_tree_returns_200(client):
    """GET /knowledge/tree should return 200."""
    resp = client.get("/knowledge/tree")
    assert resp.status_code == 200


def test_tree_root_has_children(client):
    """Tree root should contain files and directories."""
    data = client.get("/knowledge/tree").json()
    assert "children" in data
    names = [c["name"] for c in data["children"]]
    assert "readme.md" in names
    assert "guides" in names
    assert "notes.txt" in names


def test_tree_directories_have_children(client):
    """Directories in the tree should have a children list."""
    data = client.get("/knowledge/tree").json()
    guides = next(c for c in data["children"] if c["name"] == "guides")
    assert guides["type"] == "directory"
    assert "children" in guides
    child_names = [c["name"] for c in guides["children"]]
    assert "getting-started.md" in child_names
    assert "advanced.md" in child_names
    assert "extras" in child_names


def test_tree_nested_directory(client):
    """Nested directories should appear in the tree."""
    data = client.get("/knowledge/tree").json()
    guides = next(c for c in data["children"] if c["name"] == "guides")
    extras = next(c for c in guides["children"] if c["name"] == "extras")
    assert extras["type"] == "directory"
    child_names = [c["name"] for c in extras["children"]]
    assert "tips.md" in child_names


def test_tree_files_have_type(client):
    """Files should have type='file'."""
    data = client.get("/knowledge/tree").json()
    readme = next(c for c in data["children"] if c["name"] == "readme.md")
    assert readme["type"] == "file"


def test_tree_files_have_path(client):
    """Each node should include a relative path."""
    data = client.get("/knowledge/tree").json()
    readme = next(c for c in data["children"] if c["name"] == "readme.md")
    assert readme["path"] == "readme.md"

    guides = next(c for c in data["children"] if c["name"] == "guides")
    started = next(c for c in guides["children"] if c["name"] == "getting-started.md")
    assert started["path"] == "guides/getting-started.md"


def test_tree_sorted_dirs_first(client):
    """Directories should appear before files, both sorted alphabetically."""
    data = client.get("/knowledge/tree").json()
    children = data["children"]
    dirs = [c for c in children if c["type"] == "directory"]
    files = [c for c in children if c["type"] == "file"]
    # Dirs come first in the list
    if dirs and files:
        last_dir_idx = max(children.index(d) for d in dirs)
        first_file_idx = min(children.index(f) for f in files)
        assert last_dir_idx < first_file_idx


# ── GET /knowledge/file ──────────────────────────────────────────


def test_file_returns_content(client):
    """GET /knowledge/file?path=readme.md should return file content."""
    resp = client.get("/knowledge/file", params={"path": "readme.md"})
    assert resp.status_code == 200
    data = resp.json()
    assert "content" in data
    assert "# Readme" in data["content"]


def test_file_nested_path(client):
    """GET /knowledge/file with nested path should work."""
    resp = client.get("/knowledge/file", params={"path": "guides/getting-started.md"})
    assert resp.status_code == 200
    assert "# Getting Started" in resp.json()["content"]


def test_file_deep_nested(client):
    """GET /knowledge/file with deeply nested path should work."""
    resp = client.get("/knowledge/file", params={"path": "guides/extras/tips.md"})
    assert resp.status_code == 200
    assert "# Tips" in resp.json()["content"]


def test_file_not_found(client):
    """GET /knowledge/file with nonexistent path should return 404."""
    resp = client.get("/knowledge/file", params={"path": "nonexistent.md"})
    assert resp.status_code == 404


def test_file_path_traversal_blocked(client):
    """Path traversal attempts should be blocked."""
    resp = client.get("/knowledge/file", params={"path": "../../../etc/passwd"})
    assert resp.status_code == 400


def test_file_absolute_path_blocked(client):
    """Absolute paths should be blocked."""
    resp = client.get("/knowledge/file", params={"path": "/etc/passwd"})
    assert resp.status_code == 400


def test_file_missing_path_param(client):
    """GET /knowledge/file without path param should return 422."""
    resp = client.get("/knowledge/file")
    assert resp.status_code == 422


def test_file_returns_filename(client):
    """Response should include the file name."""
    resp = client.get("/knowledge/file", params={"path": "readme.md"})
    data = resp.json()
    assert data["name"] == "readme.md"
    assert data["path"] == "readme.md"


# ── DELETE /knowledge/file ────────────────────────────────────────


def test_delete_file_returns_200(client, knowledge_dir):
    """DELETE /knowledge/file should return 200 and remove the file from disk."""
    assert (knowledge_dir / "readme.md").exists()
    resp = client.delete("/knowledge/file", params={"path": "readme.md"})
    assert resp.status_code == 200
    assert not (knowledge_dir / "readme.md").exists()


def test_delete_file_response_body(client):
    """DELETE response should include path and status."""
    resp = client.delete("/knowledge/file", params={"path": "readme.md"})
    data = resp.json()
    assert data["path"] == "readme.md"
    assert data["status"] == "deleted"


def test_delete_nested_file(client, knowledge_dir):
    """DELETE should work for nested paths."""
    resp = client.delete("/knowledge/file", params={"path": "guides/getting-started.md"})
    assert resp.status_code == 200
    assert not (knowledge_dir / "guides" / "getting-started.md").exists()


def test_delete_not_found(client):
    """DELETE for nonexistent file should return 404."""
    resp = client.delete("/knowledge/file", params={"path": "nonexistent.md"})
    assert resp.status_code == 404


def test_delete_path_traversal_blocked(client):
    """DELETE with path traversal should be blocked."""
    resp = client.delete("/knowledge/file", params={"path": "../../../etc/passwd"})
    assert resp.status_code == 400


def test_delete_absolute_path_blocked(client):
    """DELETE with absolute path should be blocked."""
    resp = client.delete("/knowledge/file", params={"path": "/etc/passwd"})
    assert resp.status_code == 400


def test_delete_missing_path_param(client):
    """DELETE without path param should return 422."""
    resp = client.delete("/knowledge/file")
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_delete_cleans_up_db(client, knowledge_dir, ingest_service):
    """DELETE should remove the document record from the database."""
    file_path = knowledge_dir / "readme.md"
    # Ingest the file first so it has a DB record
    await ingest_service.ingest_file(file_path, knowledge_dir)
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM documents WHERE file_path = ?", (str(file_path),)
        )
        assert await cursor.fetchone() is not None

    # Delete via API
    resp = client.delete("/knowledge/file", params={"path": "readme.md"})
    assert resp.status_code == 200

    # DB record should be gone
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT id FROM documents WHERE file_path = ?", (str(file_path),)
        )
        assert await cursor.fetchone() is None


@pytest.mark.asyncio
async def test_delete_cleans_up_chroma(client, knowledge_dir, ingest_service):
    """DELETE should remove chunks from Chroma."""
    file_path = knowledge_dir / "readme.md"
    await ingest_service.ingest_file(file_path, knowledge_dir)
    # Verify chunks exist
    results = ingest_service.collection.get(where={"file_path": str(file_path)})
    assert len(results["ids"]) > 0

    resp = client.delete("/knowledge/file", params={"path": "readme.md"})
    assert resp.status_code == 200

    # Chroma chunks should be gone
    results = ingest_service.collection.get(where={"file_path": str(file_path)})
    assert len(results["ids"]) == 0


def test_delete_directory_blocked(client, knowledge_dir):
    """DELETE should not allow deleting directories."""
    resp = client.delete("/knowledge/file", params={"path": "guides"})
    assert resp.status_code == 400


# ── PUT /knowledge/file (rename) ─────────────────────────────────


def test_rename_file_returns_200(client, knowledge_dir):
    """PUT /knowledge/file should rename a file and return 200."""
    assert (knowledge_dir / "readme.md").exists()
    resp = client.put("/knowledge/file", json={"old_path": "readme.md", "new_path": "renamed.md"})
    assert resp.status_code == 200
    assert not (knowledge_dir / "readme.md").exists()
    assert (knowledge_dir / "renamed.md").exists()


def test_rename_file_response_body(client, knowledge_dir):
    """PUT response should include old_path, new_path, and status."""
    resp = client.put("/knowledge/file", json={"old_path": "readme.md", "new_path": "renamed.md"})
    data = resp.json()
    assert data["old_path"] == "readme.md"
    assert data["new_path"] == "renamed.md"
    assert data["status"] == "renamed"


def test_rename_preserves_content(client, knowledge_dir):
    """Renamed file should retain its original content."""
    original = (knowledge_dir / "readme.md").read_text()
    client.put("/knowledge/file", json={"old_path": "readme.md", "new_path": "renamed.md"})
    assert (knowledge_dir / "renamed.md").read_text() == original


def test_rename_nested_file(client, knowledge_dir):
    """PUT should work for files in subdirectories."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "guides/getting-started.md", "new_path": "guides/intro.md"},
    )
    assert resp.status_code == 200
    assert not (knowledge_dir / "guides" / "getting-started.md").exists()
    assert (knowledge_dir / "guides" / "intro.md").exists()


def test_rename_move_to_different_dir(client, knowledge_dir):
    """PUT should allow moving a file to a different subdirectory."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "guides/readme.md"},
    )
    assert resp.status_code == 200
    assert (knowledge_dir / "guides" / "readme.md").exists()


def test_rename_creates_parent_dirs(client, knowledge_dir):
    """PUT should create parent directories if they don't exist."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "new-dir/sub/readme.md"},
    )
    assert resp.status_code == 200
    assert (knowledge_dir / "new-dir" / "sub" / "readme.md").exists()


def test_rename_not_found(client):
    """PUT for nonexistent source file should return 404."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "nonexistent.md", "new_path": "renamed.md"},
    )
    assert resp.status_code == 404


def test_rename_target_exists(client, knowledge_dir):
    """PUT should return 409 if target file already exists."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "notes.txt"},
    )
    assert resp.status_code == 409


def test_rename_old_path_traversal_blocked(client):
    """PUT with path traversal in old_path should be blocked."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "../../../etc/passwd", "new_path": "renamed.md"},
    )
    assert resp.status_code == 400


def test_rename_new_path_traversal_blocked(client):
    """PUT with path traversal in new_path should be blocked."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "../../../tmp/evil.md"},
    )
    assert resp.status_code == 400


def test_rename_absolute_old_path_blocked(client):
    """PUT with absolute old_path should be blocked."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "/etc/passwd", "new_path": "renamed.md"},
    )
    assert resp.status_code == 400


def test_rename_absolute_new_path_blocked(client):
    """PUT with absolute new_path should be blocked."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "/tmp/evil.md"},
    )
    assert resp.status_code == 400


def test_rename_directory_blocked(client):
    """PUT should not allow renaming directories."""
    resp = client.put(
        "/knowledge/file",
        json={"old_path": "guides", "new_path": "tutorials"},
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_rename_updates_db(client, knowledge_dir, ingest_service):
    """PUT should update the file_path and file_name in the documents table."""
    file_path = knowledge_dir / "readme.md"
    await ingest_service.ingest_file(file_path, knowledge_dir)

    old_path_str = str(file_path)
    new_path_str = str(knowledge_dir / "renamed.md")

    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "renamed.md"},
    )
    assert resp.status_code == 200

    async with get_db() as db:
        # Old path should be gone
        cursor = await db.execute(
            "SELECT id FROM documents WHERE file_path = ?", (old_path_str,)
        )
        assert await cursor.fetchone() is None

        # New path should exist
        cursor = await db.execute(
            "SELECT file_path, file_name FROM documents WHERE file_path = ?",
            (new_path_str,),
        )
        row = await cursor.fetchone()
        assert row is not None
        assert row["file_name"] == "renamed.md"


@pytest.mark.asyncio
async def test_rename_updates_chroma_metadata(client, knowledge_dir, ingest_service):
    """PUT should update file_path in Chroma chunk metadata."""
    file_path = knowledge_dir / "readme.md"
    await ingest_service.ingest_file(file_path, knowledge_dir)

    old_path_str = str(file_path)
    new_path_str = str(knowledge_dir / "renamed.md")

    resp = client.put(
        "/knowledge/file",
        json={"old_path": "readme.md", "new_path": "renamed.md"},
    )
    assert resp.status_code == 200

    # Old path chunks should be gone
    results = ingest_service.collection.get(where={"file_path": old_path_str})
    assert len(results["ids"]) == 0

    # New path chunks should exist
    results = ingest_service.collection.get(where={"file_path": new_path_str})
    assert len(results["ids"]) > 0
