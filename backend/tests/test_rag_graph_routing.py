"""Tests for 3-way pre-retrieval routing in RAG graph — none/hyde/multi_query."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage

from app.config import AppConfig, PreRetrievalStrategy
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
def rag_service(mock_collection):
    svc = RAGService.__new__(RAGService)
    svc._collection = mock_collection
    svc._langfuse = None
    return svc


@pytest.fixture
def default_config():
    return AppConfig()


# ── RAGState has pre_retrieval_strategy field ─────────────────


def test_rag_state_has_pre_retrieval_strategy():
    """RAGState TypedDict includes pre_retrieval_strategy."""
    from app.services.rag_graph import RAGState
    assert "pre_retrieval_strategy" in RAGState.__annotations__


def test_rag_state_no_longer_has_use_hyde():
    """RAGState TypedDict no longer has use_hyde field."""
    from app.services.rag_graph import RAGState
    assert "use_hyde" not in RAGState.__annotations__


# ── _pre_retrieval_route function ─────────────────────────────


def test_route_none_goes_to_retrieve():
    """pre_retrieval_strategy='none' routes to retrieve."""
    from app.services.rag_graph import _pre_retrieval_route
    assert _pre_retrieval_route({"pre_retrieval_strategy": "none"}) == "retrieve"


def test_route_hyde_goes_to_hyde():
    """pre_retrieval_strategy='hyde' routes to hyde."""
    from app.services.rag_graph import _pre_retrieval_route
    assert _pre_retrieval_route({"pre_retrieval_strategy": "hyde"}) == "hyde"


def test_route_multi_query_goes_to_multi_query():
    """pre_retrieval_strategy='multi_query' routes to multi_query."""
    from app.services.rag_graph import _pre_retrieval_route
    assert _pre_retrieval_route({"pre_retrieval_strategy": "multi_query"}) == "multi_query"


def test_route_default_goes_to_retrieve():
    """Missing pre_retrieval_strategy defaults to retrieve."""
    from app.services.rag_graph import _pre_retrieval_route
    assert _pre_retrieval_route({}) == "retrieve"


# ── Full graph 3-way routing ─────────────────────────────────


@pytest.mark.asyncio
async def test_full_graph_none_skips_hyde(rag_service, default_config):
    """pre_retrieval_strategy='none' skips HyDE, goes straight to retrieve."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "none"})

    mock_hyde.assert_not_called()
    rag_service._collection.query.assert_called_once_with(query_texts=["test"], n_results=5)
    assert "answer" in result


@pytest.mark.asyncio
async def test_full_graph_hyde_calls_generate(rag_service, default_config):
    """pre_retrieval_strategy='hyde' invokes HyDE before retrieve."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        mock_hyde.return_value = "Hypothetical passage."
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "hyde"})

    mock_hyde.assert_called_once()
    rag_service._collection.query.assert_called_once_with(
        query_texts=["Hypothetical passage."], n_results=5
    )


@pytest.mark.asyncio
async def test_full_graph_multi_query_placeholder(rag_service, default_config):
    """pre_retrieval_strategy='multi_query' routes through multi_query node (placeholder pass-through)."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "multi_query"})

    # HyDE should NOT be called
    mock_hyde.assert_not_called()
    # Retrieve should still be called (multi_query placeholder passes through to retrieve)
    rag_service._collection.query.assert_called_once()
    assert "answer" in result


# ── Prep graph 3-way routing ─────────────────────────────────


@pytest.mark.asyncio
async def test_prep_graph_none_skips_hyde(rag_service):
    """Prep graph: pre_retrieval_strategy='none' skips HyDE."""
    from app.services.rag_graph import create_rag_prep_graph

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        graph = create_rag_prep_graph(rag_service, AppConfig())
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "none"})

    mock_hyde.assert_not_called()
    assert "sources" in result
    assert "messages" in result


@pytest.mark.asyncio
async def test_prep_graph_hyde_calls_generate(rag_service):
    """Prep graph: pre_retrieval_strategy='hyde' invokes HyDE."""
    from app.services.rag_graph import create_rag_prep_graph

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        mock_hyde.return_value = "Hypothetical passage."
        graph = create_rag_prep_graph(rag_service, AppConfig())
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "hyde"})

    mock_hyde.assert_called_once()
    rag_service._collection.query.assert_called_once_with(
        query_texts=["Hypothetical passage."], n_results=5
    )


@pytest.mark.asyncio
async def test_prep_graph_multi_query_placeholder(rag_service):
    """Prep graph: pre_retrieval_strategy='multi_query' uses placeholder node."""
    from app.services.rag_graph import create_rag_prep_graph

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        graph = create_rag_prep_graph(rag_service, AppConfig())
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "multi_query"})

    mock_hyde.assert_not_called()
    rag_service._collection.query.assert_called_once()
    assert "sources" in result


@pytest.mark.asyncio
async def test_prep_graph_default_routes_to_retrieve(rag_service):
    """Prep graph: missing pre_retrieval_strategy defaults to retrieve."""
    from app.services.rag_graph import create_rag_prep_graph

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        graph = create_rag_prep_graph(rag_service, AppConfig())
        result = await graph.ainvoke({"question": "test"})

    mock_hyde.assert_not_called()
    assert "sources" in result
