"""Tests for HyDE node integration in RAG graph — hyde → retrieve → build_prompt → END."""
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


# ── Full graph with HyDE ─────────────────────────────────────


@pytest.mark.asyncio
async def test_full_graph_with_hyde_calls_generate_hypothetical_doc(rag_service, default_config):
    """When pre_retrieval_strategy='hyde', the full graph calls generate_hypothetical_doc before retrieve."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        mock_hyde.return_value = "Python is a versatile programming language."
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "hyde"})

    mock_hyde.assert_called_once_with("What is Python?", default_config)
    # Retrieve was called with the hypothetical doc, not the original question
    rag_service._collection.query.assert_called_once_with(
        query_texts=["Python is a versatile programming language."], n_results=5
    )


@pytest.mark.asyncio
async def test_full_graph_without_hyde_skips_generate(rag_service, default_config):
    """When pre_retrieval_strategy='none', the full graph does NOT call generate_hypothetical_doc."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "none"})

    mock_hyde.assert_not_called()
    rag_service._collection.query.assert_called_once_with(
        query_texts=["What is Python?"], n_results=5
    )


@pytest.mark.asyncio
async def test_full_graph_default_no_hyde(rag_service, default_config):
    """When pre_retrieval_strategy is not provided, HyDE is skipped by default."""
    from app.services.rag_graph import create_rag_graph

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with (
        patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde,
        patch("app.services.rag_service.create_chat_model", return_value=mock_model),
    ):
        graph = create_rag_graph(rag_service, default_config)
        result = await graph.ainvoke({"question": "What is Python?"})

    mock_hyde.assert_not_called()


# ── Prep graph with HyDE ─────────────────────────────────────


@pytest.mark.asyncio
async def test_prep_graph_with_hyde(rag_service):
    """Prep graph with pre_retrieval_strategy='hyde' calls generate_hypothetical_doc."""
    from app.services.rag_graph import create_rag_prep_graph

    config = AppConfig()

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        mock_hyde.return_value = "Hypothetical passage about Python."
        graph = create_rag_prep_graph(rag_service, config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "hyde"})

    mock_hyde.assert_called_once_with("What is Python?", config)
    rag_service._collection.query.assert_called_once_with(
        query_texts=["Hypothetical passage about Python."], n_results=5
    )
    assert "sources" in result
    assert "messages" in result


@pytest.mark.asyncio
async def test_prep_graph_without_hyde(rag_service):
    """Prep graph with pre_retrieval_strategy='none' skips HyDE."""
    from app.services.rag_graph import create_rag_prep_graph

    config = AppConfig()

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        graph = create_rag_prep_graph(rag_service, config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "none"})

    mock_hyde.assert_not_called()
    rag_service._collection.query.assert_called_once_with(
        query_texts=["What is Python?"], n_results=5
    )


# ── HyDE preserves original question for prompt ──────────────


@pytest.mark.asyncio
async def test_hyde_uses_hypothetical_for_retrieval_but_original_for_prompt(rag_service, default_config):
    """HyDE replaces retrieval query but build_prompt still uses original question."""
    from app.services.rag_graph import create_rag_prep_graph

    config = AppConfig()

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        mock_hyde.return_value = "Hypothetical doc content."
        graph = create_rag_prep_graph(rag_service, config)
        result = await graph.ainvoke({"question": "What is Python?", "pre_retrieval_strategy": "hyde"})

    # Retrieval used hypothetical doc
    rag_service._collection.query.assert_called_once_with(
        query_texts=["Hypothetical doc content."], n_results=5
    )
    # But prompt still contains the original question
    user_msg = result["messages"][-1]
    assert "What is Python?" in user_msg["content"]


@pytest.mark.asyncio
async def test_hyde_stores_hypothetical_doc_in_state(rag_service, default_config):
    """HyDE node stores the hypothetical doc in state."""
    from app.services.rag_graph import create_rag_prep_graph

    config = AppConfig()

    with patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        mock_hyde.return_value = "Generated hypothetical passage."
        graph = create_rag_prep_graph(rag_service, config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "hyde"})

    assert result.get("hypothetical_doc") == "Generated hypothetical passage."
