"""Tests for CommunityService — manifest fetch + caching + pack file fetching."""
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
import pytest_asyncio

from app.services.community_service import (
    CommunityManifest,
    CommunityService,
    ContentPack,
    PackFile,
)


# ── Pydantic model tests ──────────────────────────────────────────────────────

def test_content_pack_model():
    pack = ContentPack(
        id="python-tips",
        name="Python Tips",
        description="Useful Python tips",
        author="Alice",
        tags=["python", "tips"],
        file_count=3,
        size_kb=120,
        path="packs/python-tips",
    )
    assert pack.id == "python-tips"
    assert pack.file_count == 3


def test_community_manifest_model():
    manifest = CommunityManifest(
        version="1.0",
        packs=[
            ContentPack(
                id="test", name="Test", description="", author="bob",
                tags=[], file_count=1, size_kb=10, path="packs/test",
            )
        ],
    )
    assert manifest.version == "1.0"
    assert len(manifest.packs) == 1


def test_pack_file_model():
    pf = PackFile(filename="intro.md", path="packs/test/intro.md", size_kb=5)
    assert pf.filename == "intro.md"


# ── fetch_manifest ────────────────────────────────────────────────────────────

SAMPLE_MANIFEST = {
    "version": "1.0",
    "packs": [
        {
            "id": "python-basics",
            "name": "Python Basics",
            "description": "Core Python concepts",
            "author": "KnowHive",
            "tags": ["python"],
            "file_count": 2,
            "size_kb": 50,
            "path": "packs/python-basics",
        }
    ],
}


@pytest.mark.asyncio
async def test_fetch_manifest_returns_community_manifest(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = SAMPLE_MANIFEST
        mock_client.get = AsyncMock(return_value=mock_resp)

        result = await svc.fetch_manifest()

    assert isinstance(result, CommunityManifest)
    assert len(result.packs) == 1
    assert result.packs[0].id == "python-basics"


@pytest.mark.asyncio
async def test_fetch_manifest_caches_result(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = SAMPLE_MANIFEST
        mock_client.get = AsyncMock(return_value=mock_resp)

        await svc.fetch_manifest()
        await svc.fetch_manifest()  # second call

    # HTTP should only be called once due to caching
    assert mock_client.get.call_count == 1


@pytest.mark.asyncio
async def test_fetch_manifest_refreshes_after_ttl(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path, cache_ttl=0)  # TTL=0 → always refresh
    with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = SAMPLE_MANIFEST
        mock_client.get = AsyncMock(return_value=mock_resp)

        await svc.fetch_manifest()
        await svc.fetch_manifest()

    assert mock_client.get.call_count == 2


# ── fetch_pack_files ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_fetch_pack_files_returns_list(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = ContentPack(
        id="test", name="Test", description="", author="bob",
        tags=[], file_count=2, size_kb=20, path="packs/test",
    )
    files_manifest = [
        {"filename": "intro.md", "path": "packs/test/intro.md", "size_kb": 5},
        {"filename": "advanced.md", "path": "packs/test/advanced.md", "size_kb": 15},
    ]
    with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
        mock_client = AsyncMock()
        mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
        mock_resp = MagicMock()
        mock_resp.raise_for_status = MagicMock()
        mock_resp.json.return_value = files_manifest
        mock_client.get = AsyncMock(return_value=mock_resp)

        result = await svc.fetch_pack_files(pack)

    assert len(result) == 2
    assert all(isinstance(f, PackFile) for f in result)
    assert result[0].filename == "intro.md"
