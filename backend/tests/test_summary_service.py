"""Tests for SummaryService — LLM summarization + DB caching."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.database import close_db, init_db
from app.services.summary_service import SummaryService


@pytest_asyncio.fixture
async def db(tmp_path):
    db_file = str(tmp_path / "test.db")
    await init_db(db_file)
    yield
    await close_db()


@pytest_asyncio.fixture
async def svc(db):
    return SummaryService()


# ── get_cached_summary ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_cached_summary_returns_none_when_missing(svc):
    result = await svc.get_cached_summary("missing/file.md")
    assert result is None


@pytest.mark.asyncio
async def test_get_cached_summary_returns_summary_after_store(svc):
    await svc.store_summary("packs/python/intro.md", "A summary of Python basics.")
    result = await svc.get_cached_summary("packs/python/intro.md")
    assert result == "A summary of Python basics."


@pytest.mark.asyncio
async def test_store_summary_overwrites_existing(svc):
    await svc.store_summary("file.md", "First summary.")
    await svc.store_summary("file.md", "Updated summary.")
    result = await svc.get_cached_summary("file.md")
    assert result == "Updated summary."


# ── generate_summary ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_generate_summary_calls_llm(svc):
    mock_rag = MagicMock()
    mock_rag.call_llm = AsyncMock(return_value="This file covers Python lists.")
    mock_config = MagicMock()
    content = "# Python Lists\n\nLists are ordered sequences."

    result = await svc.generate_summary(content, "file.md", mock_rag, mock_config)

    assert result == "This file covers Python lists."
    mock_rag.call_llm.assert_called_once()


@pytest.mark.asyncio
async def test_generate_summary_sends_content_to_llm(svc):
    mock_rag = MagicMock()
    mock_rag.call_llm = AsyncMock(return_value="Summary text.")
    mock_config = MagicMock()
    content = "Important content here."

    await svc.generate_summary(content, "file.md", mock_rag, mock_config)

    call_args = mock_rag.call_llm.call_args
    messages = call_args[0][0]
    # Content should appear in the messages
    full_text = " ".join(m["content"] for m in messages)
    assert "Important content here." in full_text


@pytest.mark.asyncio
async def test_get_or_generate_returns_cached_without_llm_call(svc, tmp_path):
    await svc.store_summary("cached.md", "Cached summary.")
    mock_rag = MagicMock()
    mock_rag.call_llm = AsyncMock(return_value="Fresh summary.")
    mock_config = MagicMock()
    knowledge_dir = tmp_path
    (knowledge_dir / "cached.md").write_text("content")

    result = await svc.get_or_generate("cached.md", knowledge_dir, mock_rag, mock_config)

    assert result == "Cached summary."
    mock_rag.call_llm.assert_not_called()


@pytest.mark.asyncio
async def test_get_or_generate_calls_llm_when_no_cache(svc, tmp_path):
    mock_rag = MagicMock()
    mock_rag.call_llm = AsyncMock(return_value="Generated summary.")
    mock_config = MagicMock()
    knowledge_dir = tmp_path
    (knowledge_dir / "new.md").write_text("# New file\n\nContent here.")

    result = await svc.get_or_generate("new.md", knowledge_dir, mock_rag, mock_config)

    assert result == "Generated summary."
    mock_rag.call_llm.assert_called_once()


@pytest.mark.asyncio
async def test_get_or_generate_stores_result_in_cache(svc, tmp_path):
    mock_rag = MagicMock()
    mock_rag.call_llm = AsyncMock(return_value="Newly generated.")
    mock_config = MagicMock()
    knowledge_dir = tmp_path
    (knowledge_dir / "uncached.md").write_text("Content.")

    await svc.get_or_generate("uncached.md", knowledge_dir, mock_rag, mock_config)
    cached = await svc.get_cached_summary("uncached.md")

    assert cached == "Newly generated."


@pytest.mark.asyncio
async def test_get_or_generate_returns_none_when_file_missing(svc, tmp_path):
    mock_rag = MagicMock()
    mock_rag.call_llm = AsyncMock(return_value="Summary.")
    mock_config = MagicMock()

    result = await svc.get_or_generate("nonexistent.md", tmp_path, mock_rag, mock_config)
    assert result is None
