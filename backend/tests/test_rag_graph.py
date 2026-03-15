"""Tests for LangGraph RAG StateGraph — retrieve → build_prompt → generate → END."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.config import AppConfig
from app.services.rag_service import RAGService


# ── Fixtures ──────────────────────────────────────────────────


@pytest.fixture
def mock_collection():
    """Mock Chroma collection with sample documents."""
    coll = MagicMock()
    coll.query.return_value = {
        "ids": [["id1", "id2"]],
        "documents": [["Python is great.", "FastAPI is fast."]],
        "metadatas": [
            [
                {"file_path": "docs/python.md", "chunk_index": 0},
                {"file_path": "docs/fastapi.md", "chunk_index": 0},
            ]
        ],
        "distances": [[0.1, 0.3]],
    }
    return coll


@pytest.fixture
def rag_service(mock_collection):
    svc = RAGService.__new__(RAGService)
    svc._collection = mock_collection
    svc._langfuse = None
    return svc


@pytest.fixture
def default_config():
    return AppConfig()


# ── Import tests ─────────────────────────────────────────────


def test_rag_graph_module_imports():
    """rag_graph module can be imported."""
    from app.services.rag_graph import create_rag_graph
    assert callable(create_rag_graph)


def test_rag_graph_state_type_imports():
    """RAGState TypedDict can be imported."""
    from app.services.rag_graph import RAGState
    assert "question" in RAGState.__annotations__


# ── Graph construction ───────────────────────────────────────


def test_create_rag_graph_returns_compiled_graph(rag_service, default_config):
    """create_rag_graph returns a compiled LangGraph."""
    from app.services.rag_graph import create_rag_graph
    graph = create_rag_graph(rag_service, default_config)
    # CompiledGraph has an invoke method
    assert hasattr(graph, "ainvoke")


# ── Graph execution ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_graph_invoke_returns_answer_and_sources(rag_service, default_config):
    """Invoking the graph returns answer and sources."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Python is a language.")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "What is Python?", "k": 5})

    assert result["answer"] == "Python is a language."
    assert "docs/python.md" in result["sources"]


@pytest.mark.asyncio
async def test_graph_populates_chunks(rag_service, default_config):
    """Graph retrieval step populates chunks in state."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test", "k": 5})

    assert len(result["chunks"]) == 2
    assert result["chunks"][0]["file_path"] == "docs/python.md"


@pytest.mark.asyncio
async def test_graph_populates_messages(rag_service, default_config):
    """Graph build_prompt step populates messages in state."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test", "k": 5})

    assert len(result["messages"]) == 2
    assert result["messages"][0]["role"] == "system"
    assert result["messages"][1]["role"] == "user"


@pytest.mark.asyncio
async def test_graph_with_custom_k(rag_service, default_config):
    """Graph respects custom k parameter."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test", "k": 3})

    # Chroma was called with k=3
    rag_service._collection.query.assert_called_once_with(query_texts=["test"], n_results=3)


@pytest.mark.asyncio
async def test_graph_extracts_unique_sources(mock_collection, default_config):
    """Graph extracts unique sources from chunks."""
    from app.services.rag_graph import create_rag_graph

    # Both chunks from same file
    mock_collection.query.return_value = {
        "ids": [["id1", "id2"]],
        "documents": [["chunk1", "chunk2"]],
        "metadatas": [
            [
                {"file_path": "docs/python.md", "chunk_index": 0},
                {"file_path": "docs/python.md", "chunk_index": 1},
            ]
        ],
        "distances": [[0.1, 0.2]],
    }

    svc = RAGService.__new__(RAGService)
    svc._collection = mock_collection
    svc._langfuse = None

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        graph = create_rag_graph(svc, default_config)
        result = await graph.ainvoke({"question": "test", "k": 5})

    assert result["sources"] == ["docs/python.md"]


@pytest.mark.asyncio
async def test_graph_default_k_is_5(rag_service, default_config):
    """Graph uses k=5 by default when not specified in input."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test"})

    rag_service._collection.query.assert_called_once_with(query_texts=["test"], n_results=5)
