"""Tests for query rewriter service — fetch history + rewrite."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import AppConfig
from app.services.query_rewriter import (
    _format_history,
    fetch_chat_context,
    fetch_chat_history,
    rewrite_query,
)


# ── _format_history ───────────────────────────────────────


def test_format_history_basic():
    history = [
        {"role": "user", "content": "What is BFS?"},
        {"role": "assistant", "content": "BFS is breadth-first search."},
    ]
    result = _format_history(history)
    assert "User: What is BFS?" in result
    assert "Assistant: BFS is breadth-first search." in result


def test_format_history_empty():
    assert _format_history([]) == ""


# ── fetch_chat_history ────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_returns_empty_for_zero_turns():
    result = await fetch_chat_history(0)
    assert result == []


@pytest.mark.asyncio
async def test_fetch_returns_empty_for_negative():
    result = await fetch_chat_history(-1)
    assert result == []


@pytest.mark.asyncio
async def test_fetch_queries_db():
    """fetch_chat_history queries the database and returns oldest-first."""
    mock_rows = [
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "question"},
    ]

    mock_cursor = AsyncMock()
    mock_cursor.fetchall.return_value = mock_rows

    mock_db = AsyncMock()
    mock_db.execute.return_value = mock_cursor

    class FakeContextManager:
        async def __aenter__(self):
            return mock_db
        async def __aexit__(self, *args):
            pass

    with patch("app.services.query_rewriter.get_db", return_value=FakeContextManager()):
        result = await fetch_chat_history(2)

    # Reversed: user first, then assistant
    assert result[0]["role"] == "user"
    assert result[1]["role"] == "assistant"
    mock_db.execute.assert_called_once()


# ── rewrite_query ─────────────────────────────────────────


@pytest.mark.asyncio
async def test_rewrite_returns_rewritten():
    mock_response = MagicMock()
    mock_response.content = "What are the time and space complexity of BFS?"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [
        {"role": "user", "content": "What is BFS?"},
        {"role": "assistant", "content": "BFS is breadth-first search."},
    ]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("What about its complexity?", history, config)

    assert result == "What are the time and space complexity of BFS?"


@pytest.mark.asyncio
async def test_rewrite_fallback_on_empty_history():
    config = AppConfig()
    result = await rewrite_query("What is BFS?", [], config)
    assert result == "What is BFS?"


@pytest.mark.asyncio
async def test_rewrite_fallback_on_empty_response():
    mock_response = MagicMock()
    mock_response.content = ""

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "hi"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("test", history, config)

    assert result == "test"


@pytest.mark.asyncio
async def test_rewrite_fallback_on_none_response():
    mock_response = MagicMock()
    mock_response.content = None

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "hi"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("test", history, config)

    assert result == "test"


@pytest.mark.asyncio
async def test_rewrite_fallback_on_error():
    mock_model = AsyncMock()
    mock_model.ainvoke.side_effect = RuntimeError("LLM error")

    config = AppConfig()
    history = [{"role": "user", "content": "hi"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("test", history, config)

    assert result == "test"


@pytest.mark.asyncio
async def test_rewrite_strips_whitespace():
    mock_response = MagicMock()
    mock_response.content = "  Standalone question here  "

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "hi"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("test", history, config)

    assert result == "Standalone question here"


@pytest.mark.asyncio
async def test_rewrite_prompt_contains_history_and_question():
    mock_response = MagicMock()
    mock_response.content = "rewritten"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "What is BFS?"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        await rewrite_query("What about DFS?", history, config)

    call_args = mock_model.ainvoke.call_args[0][0]
    human_msg = call_args[1].content
    assert "What is BFS?" in human_msg
    assert "What about DFS?" in human_msg


@pytest.mark.asyncio
async def test_rewrite_calls_create_chat_model():
    mock_response = MagicMock()
    mock_response.content = "rewritten"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "hi"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model) as mock_factory:
        await rewrite_query("test", history, config)

    mock_factory.assert_called_once_with(config)


# ── fetch_chat_context ────────────────────────────────────


@pytest.mark.asyncio
async def test_fetch_context_returns_tuple():
    """fetch_chat_context returns (summaries, messages) tuple."""
    mock_summary_rows = [{"summary": "Previous discussion about BFS."}]
    mock_msg_rows = [
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "question"},
    ]

    mock_cursor_summaries = AsyncMock()
    mock_cursor_summaries.fetchall.return_value = mock_summary_rows

    mock_cursor_msgs = AsyncMock()
    mock_cursor_msgs.fetchall.return_value = mock_msg_rows

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[mock_cursor_summaries, mock_cursor_msgs])

    class FakeContextManager:
        async def __aenter__(self):
            return mock_db
        async def __aexit__(self, *args):
            pass

    with patch("app.services.query_rewriter.get_db", return_value=FakeContextManager()):
        summaries, messages = await fetch_chat_context(5)

    assert summaries == ["Previous discussion about BFS."]
    assert len(messages) == 2


@pytest.mark.asyncio
async def test_fetch_context_empty_for_zero_turns():
    summaries, messages = await fetch_chat_context(0)
    assert summaries == []
    assert messages == []


@pytest.mark.asyncio
async def test_fetch_context_no_summaries():
    """When no summaries exist, returns empty list."""
    mock_cursor_summaries = AsyncMock()
    mock_cursor_summaries.fetchall.return_value = []

    mock_cursor_msgs = AsyncMock()
    mock_cursor_msgs.fetchall.return_value = []

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock(side_effect=[mock_cursor_summaries, mock_cursor_msgs])

    class FakeContextManager:
        async def __aenter__(self):
            return mock_db
        async def __aexit__(self, *args):
            pass

    with patch("app.services.query_rewriter.get_db", return_value=FakeContextManager()):
        summaries, messages = await fetch_chat_context(5)

    assert summaries == []


# ── rewrite_query with summaries ──────────────────────────


@pytest.mark.asyncio
async def test_rewrite_with_summaries_included_in_prompt():
    mock_response = MagicMock()
    mock_response.content = "rewritten"
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "What about DFS?"}]
    summaries = ["The user discussed BFS algorithms."]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("follow up", history, config, summaries=summaries)

    call_args = mock_model.ainvoke.call_args[0][0]
    human_msg = call_args[1].content
    assert "Earlier conversation summaries:" in human_msg
    assert "The user discussed BFS algorithms." in human_msg


@pytest.mark.asyncio
async def test_rewrite_without_summaries_no_section():
    mock_response = MagicMock()
    mock_response.content = "rewritten"
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    history = [{"role": "user", "content": "hi"}]

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        await rewrite_query("test", history, config)

    call_args = mock_model.ainvoke.call_args[0][0]
    human_msg = call_args[1].content
    assert "Earlier conversation summaries:" not in human_msg


@pytest.mark.asyncio
async def test_rewrite_summaries_only_no_history():
    """Summaries alone (no recent history) should still trigger rewrite."""
    mock_response = MagicMock()
    mock_response.content = "standalone question"
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()

    with patch("app.services.query_rewriter.create_chat_model", return_value=mock_model):
        result = await rewrite_query("test", [], config, summaries=["old summary"])

    assert result == "standalone question"


@pytest.mark.asyncio
async def test_rewrite_no_summaries_no_history_returns_original():
    config = AppConfig()
    result = await rewrite_query("test", [], config, summaries=[])
    assert result == "test"
