"""Tests for rewrite_query node in LangGraph — conditional at START based on chat_memory_turns."""
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from app.config import AppConfig
from app.services.rag_graph import (
    RAGState,
    _start_route,
    create_rag_graph,
    create_rag_prep_graph,
)


# ── RAGState field ────────────────────────────────────────


def test_rag_state_has_chat_memory_turns():
    state: RAGState = {"question": "test", "chat_memory_turns": 5}
    assert state["chat_memory_turns"] == 5


def test_rag_state_chat_memory_turns_default():
    state: RAGState = {"question": "test"}
    assert state.get("chat_memory_turns", 0) == 0


# ── _start_route ──────────────────────────────────────────


def test_start_route_rewrite_when_turns_positive():
    assert _start_route({"chat_memory_turns": 3}) == "rewrite_query"


def test_start_route_skip_when_zero():
    assert _start_route({"chat_memory_turns": 0}) == "route_pre_retrieval"


def test_start_route_skip_when_missing():
    assert _start_route({}) == "route_pre_retrieval"


# ── Full graph with memory ────────────────────────────────


@pytest.mark.asyncio
async def test_full_graph_rewrite_called_when_turns_positive():
    """When chat_memory_turns > 0, rewrite_query node is called."""
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

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch, \
         patch("app.services.rag_graph.rewrite_query", new_callable=AsyncMock) as mock_rewrite:
        mock_fetch.return_value = (
            [],  # no summaries
            [
                {"role": "user", "content": "What is BFS?"},
                {"role": "assistant", "content": "BFS is breadth-first search."},
            ],
        )
        mock_rewrite.return_value = "What is the time complexity of breadth-first search?"

        graph = create_rag_graph(mock_rag, config)
        result = await graph.ainvoke({
            "question": "What about its complexity?",
            "chat_memory_turns": 3,
        })

    mock_fetch.assert_called_once_with(3)
    mock_rewrite.assert_called_once()
    # The rewritten question should be used for retrieval
    mock_rag.retrieve.assert_called_once()
    retrieve_query = mock_rag.retrieve.call_args[0][0]
    assert retrieve_query == "What is the time complexity of breadth-first search?"


@pytest.mark.asyncio
async def test_full_graph_rewrite_skipped_when_zero():
    """When chat_memory_turns = 0, rewrite_query is not called."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = []
    mock_rag.extract_sources.return_value = []
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    config = AppConfig()

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch, \
         patch("app.services.rag_graph.rewrite_query", new_callable=AsyncMock) as mock_rewrite:

        graph = create_rag_graph(mock_rag, config)
        await graph.ainvoke({"question": "test", "chat_memory_turns": 0})

    mock_fetch.assert_not_called()
    mock_rewrite.assert_not_called()


@pytest.mark.asyncio
async def test_full_graph_rewrite_skipped_when_missing():
    """When chat_memory_turns not in state, rewrite_query is not called."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = []
    mock_rag.extract_sources.return_value = []
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    config = AppConfig()

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch:
        graph = create_rag_graph(mock_rag, config)
        await graph.ainvoke({"question": "test"})

    mock_fetch.assert_not_called()


# ── Prep graph with memory ────────────────────────────────


@pytest.mark.asyncio
async def test_prep_graph_rewrite_called():
    """Prep graph calls rewrite_query when chat_memory_turns > 0."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "doc", "file_path": "a.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.return_value = ["a.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "rewritten"},
    ]

    config = AppConfig()

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch, \
         patch("app.services.rag_graph.rewrite_query", new_callable=AsyncMock) as mock_rewrite:
        mock_fetch.return_value = ([], [{"role": "user", "content": "hi"}])
        mock_rewrite.return_value = "rewritten question"

        graph = create_rag_prep_graph(mock_rag, config)
        result = await graph.ainvoke({"question": "follow up", "chat_memory_turns": 2})

    mock_fetch.assert_called_once_with(2)
    mock_rewrite.assert_called_once()


@pytest.mark.asyncio
async def test_prep_graph_rewrite_skipped():
    """Prep graph skips rewrite when chat_memory_turns = 0."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = []
    mock_rag.extract_sources.return_value = []
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch:
        graph = create_rag_prep_graph(mock_rag)
        await graph.ainvoke({"question": "test"})

    mock_fetch.assert_not_called()


# ── Memory + pre-retrieval strategy combo ─────────────────


@pytest.mark.asyncio
async def test_memory_with_hyde():
    """Memory rewrite + HyDE: rewrite_query → route → hyde → retrieve."""
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

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch, \
         patch("app.services.rag_graph.rewrite_query", new_callable=AsyncMock) as mock_rewrite, \
         patch("app.services.rag_graph.generate_hypothetical_doc", new_callable=AsyncMock) as mock_hyde:
        mock_fetch.return_value = ([], [{"role": "user", "content": "hi"}])
        mock_rewrite.return_value = "rewritten"
        mock_hyde.return_value = "hypothetical doc"

        graph = create_rag_graph(mock_rag, config)
        result = await graph.ainvoke({
            "question": "follow up",
            "chat_memory_turns": 2,
            "pre_retrieval_strategy": "hyde",
        })

    mock_rewrite.assert_called_once()
    mock_hyde.assert_called_once()
    # retrieve should use hypothetical doc, not rewritten question
    retrieve_query = mock_rag.retrieve.call_args[0][0]
    assert retrieve_query == "hypothetical doc"


@pytest.mark.asyncio
async def test_memory_with_multi_query():
    """Memory rewrite + multi-query: rewrite_query → route → multi_query."""
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

    with patch("app.services.rag_graph.fetch_chat_context", new_callable=AsyncMock) as mock_fetch, \
         patch("app.services.rag_graph.rewrite_query", new_callable=AsyncMock) as mock_rewrite, \
         patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_fetch.return_value = ([], [{"role": "user", "content": "hi"}])
        mock_rewrite.return_value = "rewritten"
        mock_expand.return_value = ["rewritten", "variant"]

        graph = create_rag_graph(mock_rag, config)
        await graph.ainvoke({
            "question": "follow up",
            "chat_memory_turns": 2,
            "pre_retrieval_strategy": "multi_query",
        })

    mock_rewrite.assert_called_once()
    mock_expand.assert_called_once_with("rewritten", config)
