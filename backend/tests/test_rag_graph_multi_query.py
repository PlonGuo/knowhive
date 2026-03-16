"""Tests for multi-query node in LangGraph — expand, retrieve per variant, merge/dedup."""
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from app.config import AppConfig
from app.services.rag_graph import (
    _dedup_chunks,
    create_rag_graph,
    create_rag_prep_graph,
)


# ── _dedup_chunks ─────────────────────────────────────────


def test_dedup_no_duplicates():
    chunks = [
        {"content": "a", "file_path": "1.md", "chunk_index": 0},
        {"content": "b", "file_path": "2.md", "chunk_index": 0},
    ]
    assert _dedup_chunks(chunks) == chunks


def test_dedup_removes_duplicates():
    chunks = [
        {"content": "a", "file_path": "1.md", "chunk_index": 0},
        {"content": "a copy", "file_path": "1.md", "chunk_index": 0},
        {"content": "b", "file_path": "2.md", "chunk_index": 0},
    ]
    result = _dedup_chunks(chunks)
    assert len(result) == 2
    assert result[0]["content"] == "a"
    assert result[1]["content"] == "b"


def test_dedup_preserves_order():
    chunks = [
        {"content": "b", "file_path": "2.md", "chunk_index": 0},
        {"content": "a", "file_path": "1.md", "chunk_index": 0},
        {"content": "b dup", "file_path": "2.md", "chunk_index": 0},
    ]
    result = _dedup_chunks(chunks)
    assert result[0]["file_path"] == "2.md"
    assert result[1]["file_path"] == "1.md"


def test_dedup_empty():
    assert _dedup_chunks([]) == []


def test_dedup_different_chunk_index():
    chunks = [
        {"content": "a0", "file_path": "1.md", "chunk_index": 0},
        {"content": "a1", "file_path": "1.md", "chunk_index": 1},
    ]
    assert len(_dedup_chunks(chunks)) == 2


# ── Full graph multi_query ────────────────────────────────


@pytest.mark.asyncio
async def test_full_graph_multi_query_calls_expand():
    """Multi-query node calls expand_queries and retrieves per variant."""
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

    with patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_expand.return_value = ["query1", "query2", "query3"]
        graph = create_rag_graph(mock_rag, config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "multi_query"})

    mock_expand.assert_called_once_with("test", config)
    # Should call retrieve once per variant
    assert mock_rag.retrieve.call_count == 3


@pytest.mark.asyncio
async def test_full_graph_multi_query_deduplicates():
    """Multi-query merges and deduplicates chunks from multiple retrievals."""
    mock_rag = MagicMock()
    call_count = [0]

    def fake_retrieve(query, **kwargs):
        call_count[0] += 1
        if call_count[0] == 1:
            return [
                {"content": "a", "file_path": "1.md", "chunk_index": 0},
                {"content": "b", "file_path": "2.md", "chunk_index": 0},
            ]
        else:
            return [
                {"content": "a dup", "file_path": "1.md", "chunk_index": 0},
                {"content": "c", "file_path": "3.md", "chunk_index": 0},
            ]

    mock_rag.retrieve.side_effect = fake_retrieve
    mock_rag.extract_sources.side_effect = lambda chunks: [c["file_path"] for c in chunks]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    config = AppConfig()

    with patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_expand.return_value = ["q1", "q2"]
        graph = create_rag_graph(mock_rag, config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "multi_query"})

    # build_prompt receives deduped chunks (3 unique, not 4)
    chunks_passed = mock_rag.build_prompt.call_args[0][1]
    assert len(chunks_passed) == 3


@pytest.mark.asyncio
async def test_full_graph_multi_query_with_pack_id():
    """Multi-query passes pack_id to each retrieval."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = []
    mock_rag.extract_sources.return_value = []
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    config = AppConfig()

    with patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_expand.return_value = ["q1"]
        graph = create_rag_graph(mock_rag, config)
        await graph.ainvoke({
            "question": "test",
            "pre_retrieval_strategy": "multi_query",
            "pack_id": "leetcode",
        })

    mock_rag.retrieve.assert_called_once_with("q1", k=5, where={"pack_id": "leetcode"})


# ── Prep graph multi_query ────────────────────────────────


@pytest.mark.asyncio
async def test_prep_graph_multi_query():
    """Prep graph multi-query retrieves and deduplicates."""
    mock_rag = MagicMock()
    mock_rag.retrieve.return_value = [
        {"content": "doc", "file_path": "a.md", "chunk_index": 0},
    ]
    mock_rag.extract_sources.return_value = ["a.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]

    config = AppConfig()

    with patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_expand.return_value = ["q1", "q2"]
        graph = create_rag_prep_graph(mock_rag, config)
        result = await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "multi_query"})

    assert mock_rag.retrieve.call_count == 2
    assert "messages" in result
    assert "chunks" in result


@pytest.mark.asyncio
async def test_prep_graph_multi_query_with_rerank():
    """Multi-query + reranker: multi_query → rerank → build_prompt."""
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

    config = AppConfig()

    with patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_expand.return_value = ["q1"]
        graph = create_rag_prep_graph(mock_rag, config, reranker_service=mock_reranker)
        result = await graph.ainvoke({
            "question": "test",
            "pre_retrieval_strategy": "multi_query",
            "use_reranker": True,
        })

    mock_reranker.rerank.assert_called_once()
    assert result["sources"] == ["2.md"]


# ── multi_query does NOT go through standard retrieve ─────


@pytest.mark.asyncio
async def test_multi_query_skips_standard_retrieve():
    """Multi-query does its own retrieval; standard retrieve node is not called."""
    mock_rag = MagicMock()
    retrieve_calls = []
    original_retrieve = mock_rag.retrieve

    def tracking_retrieve(query, **kwargs):
        retrieve_calls.append(query)
        return [{"content": "doc", "file_path": "a.md", "chunk_index": 0}]

    mock_rag.retrieve.side_effect = tracking_retrieve
    mock_rag.extract_sources.return_value = ["a.md"]
    mock_rag.build_prompt.return_value = [
        {"role": "system", "content": "sys"},
        {"role": "user", "content": "test"},
    ]
    mock_rag.call_llm = AsyncMock(return_value="answer")

    config = AppConfig()

    with patch("app.services.rag_graph.expand_queries", new_callable=AsyncMock) as mock_expand:
        mock_expand.return_value = ["variant1"]
        graph = create_rag_graph(mock_rag, config)
        await graph.ainvoke({"question": "test", "pre_retrieval_strategy": "multi_query"})

    # Only called from multi_query node, not from retrieve node
    assert retrieve_calls == ["variant1"]
