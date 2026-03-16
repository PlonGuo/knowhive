"""Tests for community API router — GET /community/packs, POST /community/import."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.community import _reset_community_router, init_community_router, router
from app.services.community_service import CommunityManifest, CommunityService, ContentPack


def make_pack(pack_id="python-basics", imported=False):
    return ContentPack(
        id=pack_id,
        name="Python Basics",
        description="Core Python concepts",
        author="KnowHive",
        tags=["python"],
        file_count=2,
        size_kb=50,
        path=f"packs/{pack_id}",
    )


def make_manifest(*pack_ids):
    return CommunityManifest(
        version="1.0",
        packs=[make_pack(pid) for pid in pack_ids],
    )


def make_app(community_service, knowledge_dir=None):
    _reset_community_router()
    init_community_router(community_service, knowledge_dir=knowledge_dir)
    app = FastAPI()
    app.include_router(router)
    return app


# ── GET /community/packs ──────────────────────────────────────────────────────


def test_get_packs_returns_pack_list(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics", "git-cheatsheet")
    svc.fetch_manifest = AsyncMock(return_value=manifest)

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.get("/community/packs")

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2
    assert data[0]["id"] == "python-basics"
    assert data[1]["id"] == "git-cheatsheet"


def test_get_packs_includes_imported_false_when_not_present(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.get("/community/packs")

    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["imported"] is False


def test_get_packs_includes_imported_true_when_dir_exists(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)

    # Create the pack directory to simulate already imported
    pack_dir = tmp_path / "python-basics"
    pack_dir.mkdir()
    (pack_dir / "intro.md").write_text("existing")

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.get("/community/packs")

    assert resp.status_code == 200
    data = resp.json()
    assert data[0]["imported"] is True


def test_get_packs_returns_503_when_service_not_initialized():
    _reset_community_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/community/packs")
    assert resp.status_code == 503


def test_get_packs_returns_pack_metadata_fields(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.get("/community/packs")

    assert resp.status_code == 200
    pack = resp.json()[0]
    assert pack["name"] == "Python Basics"
    assert pack["description"] == "Core Python concepts"
    assert pack["author"] == "KnowHive"
    assert pack["tags"] == ["python"]
    assert pack["file_count"] == 2
    assert pack["size_kb"] == 50


# ── POST /community/import ────────────────────────────────────────────────────


def test_post_import_returns_task_id(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)
    svc.import_pack = AsyncMock(return_value={"status": "imported", "pack_id": "python-basics", "file_count": 2})

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.post("/community/import", json={"pack_id": "python-basics"})

    assert resp.status_code == 200
    data = resp.json()
    assert "task_id" in data
    assert data["pack_id"] == "python-basics"


def test_post_import_returns_status_imported(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)
    svc.import_pack = AsyncMock(return_value={"status": "imported", "pack_id": "python-basics", "file_count": 2})

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.post("/community/import", json={"pack_id": "python-basics"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "imported"


def test_post_import_returns_status_already_imported(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)
    svc.import_pack = AsyncMock(return_value={"status": "already_imported", "pack_id": "python-basics"})

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.post("/community/import", json={"pack_id": "python-basics"})

    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "already_imported"


def test_post_import_returns_404_for_unknown_pack(tmp_path):
    svc = MagicMock(spec=CommunityService)
    manifest = make_manifest("python-basics")
    svc.fetch_manifest = AsyncMock(return_value=manifest)

    client = TestClient(make_app(svc, knowledge_dir=tmp_path))
    resp = client.post("/community/import", json={"pack_id": "nonexistent-pack"})

    assert resp.status_code == 404


def test_post_import_returns_503_when_service_not_initialized():
    _reset_community_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.post("/community/import", json={"pack_id": "python-basics"})
    assert resp.status_code == 503
