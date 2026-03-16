"""Tests for AUTO/AUTO_LLM strategy wiring in route_pre_retrieval node."""
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
def auto_config():
    return AppConfig(pre_retrieval_strategy=PreRetrievalStrategy.AUTO)


@pytest.fixture
def auto_llm_config():
    return AppConfig(pre_retrieval_strategy=PreRetrievalStrategy.AUTO_LLM)


# ── route_pre_retrieval node resolves AUTO via classify_query ──────


@pytest.mark.asyncio
async def test_route_node_auto_calls_classify_query(rag_service, auto_config):
    """When strategy is 'auto', route_pre_retrieval calls classify_query()."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query", return_value="hyde") as mock_classify,
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock, return_value="hypo"),
    ):
        graph = create_rag_prep_graph(rag_service, auto_config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "auto"})

    mock_classify.assert_called_once_with("What is Python?")
    assert "sources" in result


@pytest.mark.asyncio
async def test_route_node_auto_resolves_to_multi_query(rag_service, auto_config):
    """AUTO resolving to multi_query routes through multi_query node."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query", return_value="multi_query"),
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
    ):
        graph = create_rag_prep_graph(rag_service, auto_config)
        result = await graph.ainvoke({"question": "sorting", "pre_retrieval_strategy": "auto"})

    mock_hyde.assert_not_called()
    assert "sources" in result


@pytest.mark.asyncio
async def test_route_node_auto_resolves_to_none(rag_service, auto_config):
    """AUTO resolving to 'none' goes straight to retrieve."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query", return_value="none"),
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
    ):
        graph = create_rag_prep_graph(rag_service, auto_config)
        result = await graph.ainvoke({"question": "src/App.tsx", "pre_retrieval_strategy": "auto"})

    mock_hyde.assert_not_called()
    rag_service._collection.query.assert_called_once()
    assert "sources" in result


# ── route_pre_retrieval node resolves AUTO_LLM via classify_query_llm ──


@pytest.mark.asyncio
async def test_route_node_auto_llm_calls_classify_query_llm(rag_service, auto_llm_config):
    """When strategy is 'auto_llm', route_pre_retrieval calls classify_query_llm()."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query_llm", new_callable=AsyncMock, return_value="hyde") as mock_llm,
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock, return_value="hypo"),
    ):
        graph = create_rag_prep_graph(rag_service, auto_llm_config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "auto_llm"})

    mock_llm.assert_called_once_with("What is Python?", auto_llm_config)
    assert "sources" in result


@pytest.mark.asyncio
async def test_route_node_auto_llm_resolves_to_multi_query(rag_service, auto_llm_config):
    """AUTO_LLM resolving to multi_query routes through multi_query node."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query_llm", new_callable=AsyncMock, return_value="multi_query"),
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
    ):
        graph = create_rag_prep_graph(rag_service, auto_llm_config)
        result = await graph.ainvoke({"question": "React vs Vue", "pre_retrieval_strategy": "auto_llm"})

    mock_hyde.assert_not_called()
    assert "sources" in result


@pytest.mark.asyncio
async def test_route_node_auto_llm_resolves_to_none(rag_service, auto_llm_config):
    """AUTO_LLM resolving to 'none' goes straight to retrieve."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query_llm", new_callable=AsyncMock, return_value="none"),
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
    ):
        graph = create_rag_prep_graph(rag_service, auto_llm_config)
        result = await graph.ainvoke({"question": "list files", "pre_retrieval_strategy": "auto_llm"})

    mock_hyde.assert_not_called()
    rag_service._collection.query.assert_called_once()
    assert "sources" in result


# ── Non-auto strategies bypass classifiers ─────────────────────


@pytest.mark.asyncio
async def test_explicit_hyde_does_not_call_classifier(rag_service):
    """Explicit 'hyde' strategy does NOT call classify_query."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query") as mock_classify,
        patch("app.services.rag_graph.classify_query_llm", new_callable=AsyncMock) as mock_llm,
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock, return_value="hypo"),
    ):
        graph = create_rag_prep_graph(rag_service, AppConfig())
        await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "hyde"})

    mock_classify.assert_not_called()
    mock_llm.assert_not_called()


@pytest.mark.asyncio
async def test_explicit_none_does_not_call_classifier(rag_service):
    """Explicit 'none' strategy does NOT call classify_query."""
    from app.services.rag_graph import create_rag_prep_graph

    with (
        patch("app.services.rag_graph.classify_query") as mock_classify,
        patch("app.services.rag_graph.classify_query_llm", new_callable=AsyncMock) as mock_llm,
    ):
        graph = create_rag_prep_graph(rag_service, AppConfig())
        await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "none"})

    mock_classify.assert_not_called()
    mock_llm.assert_not_called()


# ── Full graph with auto strategy ──────────────────────────────


@pytest.mark.asyncio
async def test_full_graph_auto_hyde(rag_service, auto_config):
    """Full graph with AUTO strategy resolving to hyde produces answer."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.classify_query", return_value="hyde"),
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock, return_value="hypo"),
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        graph = create_rag_graph(rag_service, auto_config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "auto"})

    assert result["answer"] == "Answer"


@pytest.mark.asyncio
async def test_full_graph_auto_llm_none(rag_service, auto_llm_config):
    """Full graph with AUTO_LLM strategy resolving to none produces answer."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Direct answer")

    with (
        patch("app.services.rag_graph.classify_query_llm", new_callable=AsyncMock, return_value="none"),
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        graph = create_rag_graph(rag_service, auto_llm_config)
        result = await graph.ainvoke({"question": "list files", "pre_retrieval_strategy": "auto_llm"})

    mock_hyde.assert_not_called()
    assert result["answer"] == "Direct answer"


# ── Chat router passes auto/auto_llm strategy value correctly ──


@pytest.mark.asyncio
async def test_chat_passes_auto_strategy_value():
    """Chat router passes 'auto' strategy value to graph state."""
    from app.config import AppConfig, PreRetrievalStrategy

    config = AppConfig(pre_retrieval_strategy=PreRetrievalStrategy.AUTO)
    assert config.pre_retrieval_strategy.value == "auto"


@pytest.mark.asyncio
async def test_chat_passes_auto_llm_strategy_value():
    """Chat router passes 'auto_llm' strategy value to graph state."""
    from app.config import AppConfig, PreRetrievalStrategy

    config = AppConfig(pre_retrieval_strategy=PreRetrievalStrategy.AUTO_LLM)
    assert config.pre_retrieval_strategy.value == "auto_llm"
