"""Tests for multi-query expansion service."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import AppConfig
from app.services.multi_query_service import _parse_numbered_lines, expand_queries


# ── _parse_numbered_lines ─────────────────────────────────


def test_parse_numbered_dot():
    text = "1. What is BFS?\n2. How does breadth-first search work?\n3. BFS algorithm explanation"
    result = _parse_numbered_lines(text)
    assert result == ["What is BFS?", "How does breadth-first search work?", "BFS algorithm explanation"]


def test_parse_numbered_paren():
    text = "1) What is BFS?\n2) How does BFS work?"
    result = _parse_numbered_lines(text)
    assert result == ["What is BFS?", "How does BFS work?"]


def test_parse_ignores_non_numbered():
    text = "Here are variants:\n1. First\n2. Second\nSome extra text"
    result = _parse_numbered_lines(text)
    assert result == ["First", "Second"]


def test_parse_empty():
    assert _parse_numbered_lines("") == []


def test_parse_no_numbered_lines():
    assert _parse_numbered_lines("just some text\nwithout numbers") == []


def test_parse_whitespace_handling():
    text = "  1.  What is BFS?  \n  2.  How does it work?  "
    result = _parse_numbered_lines(text)
    assert result == ["What is BFS?", "How does it work?"]


# ── expand_queries ────────────────────────────────────────


@pytest.mark.asyncio
async def test_expand_returns_variants():
    mock_response = MagicMock()
    mock_response.content = "1. What is BFS?\n2. Breadth-first search explanation\n3. How does BFS traversal work?"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("What is BFS?", config)

    assert len(result) >= 3
    assert "What is BFS?" in result


@pytest.mark.asyncio
async def test_expand_includes_original():
    mock_response = MagicMock()
    mock_response.content = "1. variant A\n2. variant B"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("my question", config)

    assert result[0] == "my question"


@pytest.mark.asyncio
async def test_expand_original_not_duplicated():
    mock_response = MagicMock()
    mock_response.content = "1. my question\n2. variant B"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("my question", config)

    assert result.count("my question") == 1


@pytest.mark.asyncio
async def test_expand_fallback_on_empty():
    mock_response = MagicMock()
    mock_response.content = ""

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("test", config)

    assert result == ["test"]


@pytest.mark.asyncio
async def test_expand_fallback_on_none():
    mock_response = MagicMock()
    mock_response.content = None

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("test", config)

    assert result == ["test"]


@pytest.mark.asyncio
async def test_expand_fallback_on_error():
    mock_model = AsyncMock()
    mock_model.ainvoke.side_effect = RuntimeError("LLM error")

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("test", config)

    assert result == ["test"]


@pytest.mark.asyncio
async def test_expand_fallback_on_no_numbered():
    mock_response = MagicMock()
    mock_response.content = "Here are some queries about BFS without numbering"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        result = await expand_queries("test", config)

    assert result == ["test"]


@pytest.mark.asyncio
async def test_expand_calls_create_chat_model():
    mock_response = MagicMock()
    mock_response.content = "1. v1\n2. v2"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model) as mock_factory:
        await expand_queries("test", config)

    mock_factory.assert_called_once_with(config)


@pytest.mark.asyncio
async def test_expand_prompt_contains_question():
    mock_response = MagicMock()
    mock_response.content = "1. v1"

    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = mock_response

    config = AppConfig()
    with patch("app.services.multi_query_service.create_chat_model", return_value=mock_model):
        await expand_queries("What is dynamic programming?", config)

    call_args = mock_model.ainvoke.call_args[0][0]
    # The human message should contain the question
    assert "What is dynamic programming?" in call_args[1].content
