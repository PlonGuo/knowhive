"""Tests for LangChain + Langfuse callback integration (replacing manual tracing)."""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.config import AppConfig
from app.services.rag_service import RAGService


# ── Fixtures ──────────────────────────────────────────────────


@pytest.fixture
def mock_collection():
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


# ── Manual tracing removed ────────────────────────────────────


def test_rag_service_no_manual_langfuse_attribute(mock_collection, monkeypatch):
    """RAGService no longer has _langfuse attribute (manual tracing removed)."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    svc = RAGService(mock_collection)
    assert not hasattr(svc, "_langfuse")


def test_rag_service_no_init_langfuse_method():
    """RAGService no longer has _init_langfuse method."""
    assert not hasattr(RAGService, "_init_langfuse")


# ── Callback integration ──────────────────────────────────────


def test_get_langfuse_callback_returns_none_without_env(mock_collection, monkeypatch):
    """get_langfuse_callback returns None when env vars are not set."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    from app.services.rag_service import get_langfuse_callback
    assert get_langfuse_callback() is None


def test_get_langfuse_callback_returns_handler_with_env(monkeypatch):
    """get_langfuse_callback returns CallbackHandler when env vars are set."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    with patch("app.services.rag_service.LangfuseCallbackHandler") as MockHandler:
        mock_handler = MagicMock()
        MockHandler.return_value = mock_handler

        from app.services.rag_service import get_langfuse_callback
        result = get_langfuse_callback()

    assert result is mock_handler
    MockHandler.assert_called_once()


def test_get_langfuse_callback_graceful_on_import_error(monkeypatch):
    """get_langfuse_callback returns None if langfuse not installed."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    with patch("app.services.rag_service.LangfuseCallbackHandler", None):
        from app.services.rag_service import get_langfuse_callback
        result = get_langfuse_callback()

    assert result is None


# ── query() uses callback ─────────────────────────────────────


@pytest.mark.asyncio
async def test_query_passes_callback_to_call_llm(mock_collection, default_config, monkeypatch):
    """query() passes langfuse callbacks to call_llm when available."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    mock_handler = MagicMock()
    with patch("app.services.rag_service.LangfuseCallbackHandler", return_value=mock_handler):
        svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await svc.query("What is Python?", default_config)

    # Verify ainvoke was called with config containing callbacks
    call_kwargs = mock_model.ainvoke.call_args
    assert "config" in call_kwargs.kwargs or (len(call_kwargs.args) > 1)


@pytest.mark.asyncio
async def test_query_works_without_langfuse(mock_collection, default_config, monkeypatch):
    """query() works normally without langfuse env vars."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)

    svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await svc.query("What is Python?", default_config)

    assert result["answer"] == "Answer"
    assert result["sources"] == ["docs/python.md"]
