"""Tests for Langfuse tracing in RAGService — env var gated."""
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.config import AppConfig
from app.services.rag_service import RAGService


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


@pytest.fixture
def rag_service(mock_collection):
    svc = RAGService(mock_collection)
    return svc


# ── Initialization tests ─────────────────────────────────────


def test_langfuse_disabled_when_no_env(mock_collection, monkeypatch):
    """RAGService has no Langfuse client when env vars are absent."""
    monkeypatch.delenv("LANGFUSE_PUBLIC_KEY", raising=False)
    monkeypatch.delenv("LANGFUSE_SECRET_KEY", raising=False)
    svc = RAGService(mock_collection)
    assert svc._langfuse is None


def test_langfuse_enabled_when_env_set(mock_collection, monkeypatch):
    """RAGService creates Langfuse client when env vars are present."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test-123")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test-456")
    with patch("app.services.rag_service.Langfuse") as MockLF:
        mock_lf = MagicMock()
        MockLF.return_value = mock_lf
        svc = RAGService(mock_collection)

    assert svc._langfuse is mock_lf
    MockLF.assert_called_once()


def test_langfuse_enabled_with_custom_host(mock_collection, monkeypatch):
    """Langfuse respects LANGFUSE_HOST env var."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test-123")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test-456")
    monkeypatch.setenv("LANGFUSE_HOST", "https://custom.langfuse.com")
    with patch("app.services.rag_service.Langfuse") as MockLF:
        svc = RAGService(mock_collection)

    MockLF.assert_called_once()


# ── Tracing on query() ───────────────────────────────────────


@pytest.mark.asyncio
async def test_query_creates_trace_when_enabled(mock_collection, default_config, monkeypatch):
    """query() creates a Langfuse trace when tracing is enabled."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    mock_lf = MagicMock()
    mock_trace = MagicMock()
    mock_lf.trace.return_value = mock_trace
    mock_span = MagicMock()
    mock_trace.span.return_value = mock_span
    mock_generation = MagicMock()
    mock_trace.generation.return_value = mock_generation

    with patch("app.services.rag_service.Langfuse", return_value=mock_lf):
        svc = RAGService(mock_collection)

    # Mock LLM call via LangChain
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await svc.query("What is Python?", default_config)

    # Trace was created
    mock_lf.trace.assert_called_once()
    trace_kwargs = mock_lf.trace.call_args[1]
    assert trace_kwargs["name"] == "rag-query"
    assert trace_kwargs["input"] == "What is Python?"

    # Retrieval span was created
    mock_trace.span.assert_called()
    span_calls = [c for c in mock_trace.span.call_args_list if c[1].get("name") == "retrieval"]
    assert len(span_calls) == 1

    # Generation span was created
    mock_trace.generation.assert_called_once()
    gen_kwargs = mock_trace.generation.call_args[1]
    assert gen_kwargs["name"] == "llm-call"
    assert gen_kwargs["model"] == "llama3"


@pytest.mark.asyncio
async def test_query_no_trace_when_disabled(mock_collection, default_config, monkeypatch):
    """query() works normally without Langfuse when env vars are absent."""
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
async def test_trace_records_output(mock_collection, default_config, monkeypatch):
    """Trace is updated with output after query completes."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    mock_lf = MagicMock()
    mock_trace = MagicMock()
    mock_lf.trace.return_value = mock_trace
    mock_span = MagicMock()
    mock_trace.span.return_value = mock_span
    mock_generation = MagicMock()
    mock_trace.generation.return_value = mock_generation

    with patch("app.services.rag_service.Langfuse", return_value=mock_lf):
        svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="The answer is 42")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        await svc.query("What is the answer?", default_config)

    # Generation end should record the output
    mock_generation.end.assert_called_once()
    end_kwargs = mock_generation.end.call_args[1]
    assert end_kwargs["output"] == "The answer is 42"

    # Trace should be updated with final output
    mock_trace.update.assert_called()


@pytest.mark.asyncio
async def test_trace_error_does_not_break_query(mock_collection, default_config, monkeypatch):
    """If Langfuse tracing raises, the query still succeeds."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    mock_lf = MagicMock()
    mock_lf.trace.side_effect = Exception("Langfuse is down")

    with patch("app.services.rag_service.Langfuse", return_value=mock_lf):
        svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Still works")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await svc.query("test", default_config)

    assert result["answer"] == "Still works"


@pytest.mark.asyncio
async def test_retrieval_span_records_chunk_count(mock_collection, default_config, monkeypatch):
    """Retrieval span records the number of chunks retrieved."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    mock_lf = MagicMock()
    mock_trace = MagicMock()
    mock_lf.trace.return_value = mock_trace
    mock_span = MagicMock()
    mock_trace.span.return_value = mock_span
    mock_generation = MagicMock()
    mock_trace.generation.return_value = mock_generation

    with patch("app.services.rag_service.Langfuse", return_value=mock_lf):
        svc = RAGService(mock_collection)

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        await svc.query("test", default_config, k=3)

    # Check retrieval span was created with input
    span_calls = [c for c in mock_trace.span.call_args_list if c[1].get("name") == "retrieval"]
    assert len(span_calls) == 1
    span_kwargs = span_calls[0][1]
    assert span_kwargs["input"] == {"query": "test", "k": 3}

    # Span end should record output with chunk count
    mock_span.end.assert_called_once()
    end_kwargs = mock_span.end.call_args[1]
    assert end_kwargs["output"]["num_chunks"] == 1
    assert end_kwargs["output"]["sources"] == ["docs/python.md"]


# ── Constructor backward compatibility ───────────────────────


def test_constructor_still_works_without_langfuse_import(mock_collection, monkeypatch):
    """RAGService works even if langfuse package is not installed (graceful degradation)."""
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", "pk-test")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-test")

    with patch("app.services.rag_service.Langfuse", None):
        svc = RAGService(mock_collection)

    assert svc._langfuse is None
