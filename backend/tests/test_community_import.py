"""Tests for CommunityService.import_pack — download pack files to knowledge dir."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.community_service import ContentPack, CommunityService, PackFile


def make_pack(pack_id="python-basics"):
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


def make_pack_files():
    return [
        PackFile(filename="intro.md", path="packs/python-basics/intro.md", size_kb=20),
        PackFile(filename="advanced.md", path="packs/python-basics/advanced.md", size_kb=30),
    ]


# ── import_pack ───────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_import_pack_creates_pack_dir(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    pack_files = make_pack_files()

    with patch.object(svc, "fetch_pack_files", AsyncMock(return_value=pack_files)):
        with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.content = b"# Intro"
            mock_client.get = AsyncMock(return_value=mock_resp)

            await svc.import_pack(pack)

    pack_dir = tmp_path / "python-basics"
    assert pack_dir.exists()


@pytest.mark.asyncio
async def test_import_pack_downloads_all_files(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    pack_files = make_pack_files()

    with patch.object(svc, "fetch_pack_files", AsyncMock(return_value=pack_files)):
        with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.content = b"# Content"
            mock_client.get = AsyncMock(return_value=mock_resp)

            await svc.import_pack(pack)

    pack_dir = tmp_path / "python-basics"
    assert (pack_dir / "intro.md").exists()
    assert (pack_dir / "advanced.md").exists()


@pytest.mark.asyncio
async def test_import_pack_writes_file_content(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    pack_files = [PackFile(filename="intro.md", path="packs/python-basics/intro.md", size_kb=5)]

    with patch.object(svc, "fetch_pack_files", AsyncMock(return_value=pack_files)):
        with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.content = b"# Python Intro\n\nHello world."
            mock_client.get = AsyncMock(return_value=mock_resp)

            await svc.import_pack(pack)

    content = (tmp_path / "python-basics" / "intro.md").read_bytes()
    assert content == b"# Python Intro\n\nHello world."


@pytest.mark.asyncio
async def test_import_pack_detects_already_imported(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    # Pre-create the pack dir with a file to simulate "already imported"
    pack_dir = tmp_path / "python-basics"
    pack_dir.mkdir()
    (pack_dir / "intro.md").write_text("existing")

    result = await svc.import_pack(pack)
    assert result["status"] == "already_imported"


@pytest.mark.asyncio
async def test_import_pack_returns_success_dict(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    pack_files = make_pack_files()

    with patch.object(svc, "fetch_pack_files", AsyncMock(return_value=pack_files)):
        with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_resp = MagicMock()
            mock_resp.raise_for_status = MagicMock()
            mock_resp.content = b"# Content"
            mock_client.get = AsyncMock(return_value=mock_resp)

            result = await svc.import_pack(pack)

    assert result["status"] == "imported"
    assert result["pack_id"] == "python-basics"
    assert result["file_count"] == 2


@pytest.mark.asyncio
async def test_import_pack_handles_download_error(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    pack_files = make_pack_files()

    with patch.object(svc, "fetch_pack_files", AsyncMock(return_value=pack_files)):
        with patch("app.services.community_service.httpx.AsyncClient") as mock_cls:
            mock_client = AsyncMock()
            mock_cls.return_value.__aenter__ = AsyncMock(return_value=mock_client)
            mock_cls.return_value.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(side_effect=Exception("network error"))

            with pytest.raises(Exception, match="network error"):
                await svc.import_pack(pack)


@pytest.mark.asyncio
async def test_import_pack_is_already_imported_returns_existing_file_info(tmp_path):
    svc = CommunityService(knowledge_dir=tmp_path)
    pack = make_pack()
    pack_dir = tmp_path / "python-basics"
    pack_dir.mkdir()
    (pack_dir / "notes.md").write_text("existing content")

    result = await svc.import_pack(pack)
    assert result["status"] == "already_imported"
    assert result["pack_id"] == "python-basics"
