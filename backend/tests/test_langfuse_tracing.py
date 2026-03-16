"""Tests for Langfuse tracing via LangChain callbacks (replacing manual tracing)."""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.config import AppConfig
from app.services.rag_service import RAGService, get_langfuse_callback


# ── Fixtures ──────────────────────────────────────────────────


@pytest.fixture
def mock_collection():
    """Mock Chroma collection."""
    coll = MagicMock()
    coll.query.return_value = {
        "ids": [["id1"]],
        "documents": [["Python is great."]],
        "metadatas": [[{"file_path": "docs/python.md", "chunk_index": 0}]],
        "distances": [[0.1]],
    }
    return coll


@pytest.fixture
def default_config():
    return AppConfig()


# ── get_langfuse_callback tests ─────────────────────────────


def test_langfuse_disabled_when_no_env(monkeypatch):
    """get_langfuse_callback returns None when env vars are absent."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    assert get_langfuse_callback() is None


def test_langfuse_enabled_when_env_set(monkeypatch):
    """get_langfuse_callback returns CallbackHandler when env vars are present."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test-123")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test-456")
    with patch("app.services.rag_service.LangfuseCallbackHandler") as MockHandler:
        mock_handler = MagicMock()
        MockHandler.return_value = mock_handler
        result = get_langfuse_callback()
    assert result is mock_handler
    MockHandler.assert_called_once()


def test_langfuse_returns_none_on_missing_public_key(monkeypatch):
    """get_langfuse_callback returns None when only secret key is set."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test-456")
    assert get_langfuse_callback() is None


def test_langfuse_graceful_when_not_installed(monkeypatch):
    """get_langfuse_callback returns None if langfuse is not installed."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    with patch("app.services.rag_service.LangfuseCallbackHandler", None):
        assert get_langfuse_callback() is None


def test_langfuse_graceful_on_init_error(monkeypatch):
    """get_langfuse_callback returns None if handler creation fails."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")
    with patch("app.services.rag_service.LangfuseCallbackHandler", side_effect=Exception("fail")):
        assert get_langfuse_callback() is None


# ── query() with callbacks ──────────────────────────────────


@pytest.mark.asyncio
async def test_query_passes_callback_when_enabled(mock_collection, default_config, monkeypatch):
    """query() passes Langfuse callback to call_llm when env vars are set."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    mock_handler = MagicMock()

    svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
        patch("app.services.rag_service.get_langfuse_callback", return_value=mock_handler),
    ):
        result = await svc.query("What is Python?", default_config)

    assert result["answer"] == "Answer"
    # Verify ainvoke was called with config containing callbacks
    call_args = mock_model.ainvoke.call_args
    assert "config" in call_args.kwargs
    assert mock_handler in call_args.kwargs["config"]["callbacks"]


@pytest.mark.asyncio
async def test_query_no_callback_when_disabled(mock_collection, default_config, monkeypatch):
    """query() works without callbacks when Langfuse env vars are absent."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await svc.query("What is Python?", default_config)

    assert result["answer"] == "Answer"
    assert result["sources"] == ["docs/python.md"]


@pytest.mark.asyncio
async def test_query_still_works_if_callback_creation_fails(mock_collection, default_config, monkeypatch):
    """query() works even if Langfuse callback creation fails."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Still works")

    with (
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
        patch("app.services.rag_service.get_langfuse_callback", return_value=None),
    ):
        result = await svc.query("test", default_config)

    assert result["answer"] == "Still works"
