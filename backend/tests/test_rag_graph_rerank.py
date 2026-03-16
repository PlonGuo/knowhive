"""Tests for rerank node in LangGraph — conditional after retrieve."""
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from app.config import AppConfig
from app.services.rag_graph import (
    RAGState,
    _post_retrieve_route,
    create_rag_graph,
    create_rag_prep_graph,
)


# ── RAGState field ────────────────────────────────────────


def test_rag_state_has_use_reranker():
    state: RAGState = {"question": "test", "use_reranker": True}
    assert state["use_reranker"] is True


def test_rag_state_use_reranker_default():
    state: RAGState = {"question": "test"}
    assert state.get("use_reranker", False) is False


# ── _post_retrieve_route ─────────────────────────────────


def test_route_rerank_when_true():
    assert _post_retrieve_route({"use_reranker": True}) == "rerank"


def test_route_build_prompt_when_false():
    assert _post_retrieve_route({"use_reranker": False}) == "build_prompt"


def test_route_build_prompt_when_missing():
    assert _post_retrieve_route({}) == "build_prompt"


# ── Full graph with reranker ─────────────────────────────


@pytest.mark.asyncio
async def test_full_graph_rerank_enabled():
    """When use_reranker=True, rerank node is called and reorders chunks."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "low", "file_path": "a.md", "chunk_index": 0},
        {"content": "high", "file_path": "b.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.side_effect = lambda chunks: [c["file_path"] for c in chunks]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    mock_reranker = MagicMock()
    mock_reranker.rerank.return_value = [
        {"content": "high", "file_path": "b.md", "chunk_index": 0, "rerank_score": 0.9},
        {"content": "low", "file_path": "a.md", "chunk_index": 0, "rerank_score": 0.1},
    ]

    config = AppConfig()
    graph = create_rag_graph(mock_rag, config, reranker_service=mock_reranker)
    result = await graph.ainvoke({"question": "test", "use_reranker": True})

    mock_reranker.rerank.assert_called_once()
    # build_prompt should receive reranked chunks (high first)
    call_args = mock_rag.build_prompt.call_args
    chunks_passed = call_args[0][1]
    assert chunks_passed[0]["content"] == "high"


@pytest.mark.asyncio
async def test_full_graph_rerank_disabled():
    """When use_reranker=False, rerank node is skipped."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "doc1", "file_path": "a.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.return_value = ["a.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    mock_reranker = MagicMock()

    config = AppConfig()
    graph = create_rag_graph(mock_rag, config, reranker_service=mock_reranker)
    result = await graph.ainvoke({"question": "test", "use_reranker": False})

    mock_reranker.rerank.assert_not_called()


@pytest.mark.asyncio
async def test_full_graph_rerank_default_disabled():
    """Without use_reranker in state, rerank is skipped."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = []
    mock_rag.extract_sources.return_value = []
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    mock_reranker = MagicMock()

    config = AppConfig()
    graph = create_rag_graph(mock_rag, config, reranker_service=mock_reranker)
    await graph.ainvoke({"question": "test"})

    mock_reranker.rerank.assert_not_called()


# ── Prep graph with reranker ─────────────────────────────


@pytest.mark.asyncio
async def test_prep_graph_rerank_enabled():
    """Prep graph reranks when use_reranker=True."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "a", "file_path": "1.md", "chunk_index": 0},
        {"content": "b", "file_path": "2.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.side_effect = lambda chunks: [c["file_path"] for c in chunks]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]

    mock_reranker = MagicMock()
    mock_reranker.rerank.return_value = [
        {"content": "b", "file_path": "2.md", "chunk_index": 0, "rerank_score": 0.9},
    ]

    graph = create_rag_prep_graph(mock_rag, reranker_service=mock_reranker)
    result = await graph.ainvoke({"question": "test", "use_reranker": True})

    mock_reranker.rerank.assert_called_once()
    # Sources should be updated after rerank
    assert result["sources"] == ["2.md"]


@pytest.mark.asyncio
async def test_prep_graph_rerank_disabled():
    """Prep graph skips rerank when use_reranker=False."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "a", "file_path": "1.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.return_value = ["1.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]

    mock_reranker = MagicMock()

    graph = create_rag_prep_graph(mock_rag, reranker_service=mock_reranker)
    await graph.ainvoke({"question": "test", "use_reranker": False})

    mock_reranker.rerank.assert_not_called()


# ── Rerank without reranker_service (None) ───────────────


@pytest.mark.asyncio
async def test_full_graph_no_reranker_service():
    """When reranker_service is None and use_reranker=True, rerank node is no-op."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "doc", "file_path": "a.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.return_value = ["a.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    config = AppConfig()
    # No reranker_service passed
    graph = create_rag_graph(mock_rag, config)
    result = await graph.ainvoke({"question": "test", "use_reranker": True})

    assert result["answer"] == "answer"


# ── Rerank updates sources ───────────────────────────────


@pytest.mark.asyncio
async def test_rerank_updates_sources():
    """After reranking, sources should reflect the reranked (potentially filtered) chunks."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "a", "file_path": "1.md", "chunk_index": 0},
        {"content": "b", "file_path": "2.md", "chunk_index": 0},
        {"content": "c", "file_path": "3.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.side_effect = lambda chunks: list(dict.fromkeys(c["file_path"] for c in chunks))
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    mock_reranker = MagicMock()
    # Reranker returns only top 2
    mock_reranker.rerank.return_value = [
        {"content": "c", "file_path": "3.md", "chunk_index": 0, "rerank_score": 0.9},
        {"content": "a", "file_path": "1.md", "chunk_index": 0, "rerank_score": 0.5},
    ]

    config = AppConfig()
    graph = create_rag_graph(mock_rag, config, reranker_service=mock_reranker)
    result = await graph.ainvoke({"question": "test", "use_reranker": True})

    assert result["sources"] == ["3.md", "1.md"]


# ── Rerank passes query from state ──────────────────────


@pytest.mark.asyncio
async def test_rerank_uses_original_question():
    """Rerank node passes the original question (not hypothetical_doc) to reranker."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "doc", "file_path": "a.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.return_value = ["a.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    mock_reranker = MagicMock()
    mock_reranker.rerank.return_value = [
        {"content": "doc", "file_path": "a.md", "chunk_index": 0, "rerank_score": 0.9},
    ]

    config = AppConfig()
    graph = create_rag_graph(mock_rag, config, reranker_service=mock_reranker)
    await graph.ainvoke({"question": "my question", "use_reranker": True})

    mock_reranker.rerank.assert_called_once()
    call_args = mock_reranker.rerank.call_args
    assert call_args[0][0] == "my question"
