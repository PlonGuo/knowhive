"""Tests for RAG query service — Chroma retrieval, prompt assembly, LLM call."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.config import AppConfig, LLMProvider
from app.services.rag_service import RAGService


# ── Fixtures ──────────────────────────────────────────────────


@pytest.fixture
def mock_collection():
    """Mock Chroma collection with sample documents."""
    coll = MagicMock()
    coll.query.return_value = {
        "ids": [["id1", "id2", "id3"]],
        "documents": [
            [
                "Python is a programming language.",
                "FastAPI is a web framework for Python.",
                "Chroma is a vector database.",
            ]
        ],
        "metadatas": [
            [
                {"file_path": "docs/python.md", "chunk_index": 0},
                {"file_path": "docs/python.md", "chunk_index": 1},
                {"file_path": "docs/chroma.md", "chunk_index": 0},
            ]
        ],
        "distances": [[0.1, 0.3, 0.5]],
    }
    return coll


@pytest.fixture
def rag_service(mock_collection):
    """RAGService with mocked Chroma collection."""
    svc = RAGService.__new__(RAGService)
    svc._collection = mock_collection
    svc._langfuse = None
    return svc


@pytest.fixture
def default_config():
    return AppConfig()


@pytest.fixture
def openai_config():
    return AppConfig(
        llm_provider=LLMProvider.OPENAI_COMPATIBLE,
        model_name="gpt-4o",
        base_url="http://localhost:8080/v1",
        api_key="test-key",
    )


@pytest.fixture
def anthropic_config():
    return AppConfig(
        llm_provider=LLMProvider.ANTHROPIC,
        model_name="claude-sonnet-4-20250514",
        base_url="https://api.anthropic.com",
        api_key="sk-ant-test-key",
    )


# ── Retrieval tests ──────────────────────────────────────────


def test_retrieve_returns_chunks(rag_service, mock_collection):
    """retrieve() calls collection.query and returns chunks with metadata."""
    results = rag_service.retrieve("What is Python?", k=3)

    mock_collection.query.assert_called_once_with(
        query_texts=["What is Python?"],
        n_results=3,
    )
    assert len(results) == 3
    assert results[0]["content"] == "Python is a programming language."
    assert results[0]["file_path"] == "docs/python.md"
    assert results[0]["chunk_index"] == 0


def test_retrieve_custom_k(rag_service, mock_collection):
    """retrieve() respects custom k value."""
    mock_collection.query.return_value = {
        "ids": [["id1"]],
        "documents": [["chunk1"]],
        "metadatas": [[{"file_path": "a.md", "chunk_index": 0}]],
        "distances": [[0.1]],
    }
    results = rag_service.retrieve("query", k=1)
    mock_collection.query.assert_called_once_with(query_texts=["query"], n_results=1)
    assert len(results) == 1


def test_retrieve_default_k(rag_service, mock_collection):
    """Default k=5."""
    rag_service.retrieve("test query")
    mock_collection.query.assert_called_once_with(query_texts=["test query"], n_results=5)


def test_retrieve_empty_results(rag_service, mock_collection):
    """retrieve() returns empty list when no matches."""
    mock_collection.query.return_value = {
        "ids": [[]],
        "documents": [[]],
        "metadatas": [[]],
        "distances": [[]],
    }
    results = rag_service.retrieve("obscure query")
    assert results == []


# ── Source extraction ─────────────────────────────────────────


def test_extract_sources(rag_service):
    """extract_sources() returns unique file paths."""
    chunks = [
        {"content": "c1", "file_path": "docs/python.md", "chunk_index": 0},
        {"content": "c2", "file_path": "docs/python.md", "chunk_index": 1},
        {"content": "c3", "file_path": "docs/chroma.md", "chunk_index": 0},
    ]
    sources = rag_service.extract_sources(chunks)
    assert sources == ["docs/python.md", "docs/chroma.md"]


def test_extract_sources_empty(rag_service):
    """extract_sources() returns empty list for no chunks."""
    assert rag_service.extract_sources([]) == []


# ── Prompt assembly ───────────────────────────────────────────


def test_build_prompt_with_context(rag_service):
    """build_prompt() includes context chunks and user question."""
    chunks = [
        {"content": "Python is great.", "file_path": "a.md", "chunk_index": 0},
        {"content": "FastAPI rocks.", "file_path": "b.md", "chunk_index": 0},
    ]
    messages = rag_service.build_prompt("What is Python?", chunks)

    assert len(messages) == 2  # system + user
    assert messages[0]["role"] == "system"
    assert "knowledge base" in messages[0]["content"].lower()

    user_msg = messages[1]["content"]
    assert "Python is great." in user_msg
    assert "FastAPI rocks." in user_msg
    assert "What is Python?" in user_msg


def test_build_prompt_no_context(rag_service):
    """build_prompt() works with empty context."""
    messages = rag_service.build_prompt("Hello?", [])

    assert len(messages) == 2
    user_msg = messages[1]["content"]
    assert "Hello?" in user_msg
    # Should indicate no context found
    assert "no relevant" in user_msg.lower() or "no context" in user_msg.lower()


# ── LLM call (Ollama) ────────────────────────────────────────


@pytest.mark.asyncio
async def test_call_llm_ollama(rag_service, default_config):
    """call_llm() sends correct request to Ollama API."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "message": {"content": "Hello! How can I help?"},
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await rag_service.call_llm(messages, default_config)

    assert result == "Hello! How can I help?"
    mock_client.post.assert_called_once()
    call_args = mock_client.post.call_args
    assert "/api/chat" in call_args[0][0]
    body = call_args[1]["json"]
    assert body["model"] == "llama3"
    assert body["messages"] == messages
    assert body["stream"] is False


@pytest.mark.asyncio
async def test_call_llm_openai(rag_service, openai_config):
    """call_llm() sends correct request to OpenAI-compatible API."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "choices": [{"message": {"content": "Hi there!"}}],
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await rag_service.call_llm(messages, openai_config)

    assert result == "Hi there!"
    call_args = mock_client.post.call_args
    assert "/chat/completions" in call_args[0][0]
    assert call_args[1]["headers"]["Authorization"] == "Bearer test-key"


@pytest.mark.asyncio
async def test_call_llm_connection_error(rag_service, default_config):
    """call_llm() raises on connection error."""
    messages = [{"role": "user", "content": "Hi"}]

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.side_effect = httpx.ConnectError("Connection refused")
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(ConnectionError, match="LLM connection failed"):
            await rag_service.call_llm(messages, default_config)


@pytest.mark.asyncio
async def test_call_llm_bad_status(rag_service, default_config):
    """call_llm() raises on non-200 response."""
    messages = [{"role": "user", "content": "Hi"}]
    mock_response = MagicMock()
    mock_response.status_code = 500
    mock_response.text = "Internal Server Error"

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(RuntimeError, match="LLM returned status 500"):
            await rag_service.call_llm(messages, default_config)


# ── Full query pipeline ──────────────────────────────────────


@pytest.mark.asyncio
async def test_query_full_pipeline(rag_service, mock_collection, default_config):
    """query() orchestrates retrieve → build_prompt → call_llm."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "message": {"content": "Python is a programming language created by Guido."},
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await rag_service.query("What is Python?", default_config)

    assert result["answer"] == "Python is a programming language created by Guido."
    assert "docs/python.md" in result["sources"]
    assert "docs/chroma.md" in result["sources"]
    mock_collection.query.assert_called_once()


@pytest.mark.asyncio
async def test_query_no_results(rag_service, mock_collection, default_config):
    """query() handles no retrieval results gracefully."""
    mock_collection.query.return_value = {
        "ids": [[]],
        "documents": [[]],
        "metadatas": [[]],
        "distances": [[]],
    }
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "message": {"content": "I don't have relevant information."},
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await rag_service.query("Unknown topic", default_config)

    assert result["answer"] == "I don't have relevant information."
    assert result["sources"] == []


@pytest.mark.asyncio
async def test_query_custom_k(rag_service, mock_collection, default_config):
    """query() passes k to retrieve()."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "message": {"content": "Answer"},
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        await rag_service.query("test", default_config, k=10)

    mock_collection.query.assert_called_once_with(query_texts=["test"], n_results=10)


# ── LLM call (Anthropic) ────────────────────────────────────


@pytest.mark.asyncio
async def test_call_llm_anthropic(rag_service, anthropic_config):
    """call_llm() sends correct request to Anthropic Messages API."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": "Hello from Claude!"}],
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await rag_service.call_llm(messages, anthropic_config)

    assert result == "Hello from Claude!"
    call_args = mock_client.post.call_args
    # Endpoint is /v1/messages
    assert "/v1/messages" in call_args[0][0]
    # Uses x-api-key header (not Bearer)
    assert call_args[1]["headers"]["x-api-key"] == "sk-ant-test-key"
    assert call_args[1]["headers"]["anthropic-version"] == "2023-06-01"
    # System prompt extracted from messages into 'system' field
    body = call_args[1]["json"]
    assert body["system"] == "You are helpful."
    assert body["model"] == "claude-sonnet-4-20250514"
    assert body["max_tokens"] == 4096
    # Messages should NOT contain system role
    assert all(m["role"] != "system" for m in body["messages"])
    assert body["messages"] == [{"role": "user", "content": "Hi"}]


@pytest.mark.asyncio
async def test_call_llm_anthropic_no_system(rag_service, anthropic_config):
    """call_llm() works with Anthropic when no system message is present."""
    messages = [{"role": "user", "content": "Hi"}]
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "content": [{"type": "text", "text": "Hello!"}],
    }

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        result = await rag_service.call_llm(messages, anthropic_config)

    assert result == "Hello!"
    body = mock_client.post.call_args[1]["json"]
    # No system field when no system message
    assert "system" not in body
    assert body["messages"] == [{"role": "user", "content": "Hi"}]


# ── LLM streaming (Anthropic) ──────────────────────────────


@pytest.mark.asyncio
async def test_call_llm_stream_anthropic(rag_service, anthropic_config):
    """call_llm_stream() yields tokens from Anthropic SSE stream."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]

    # Simulate Anthropic SSE lines
    sse_lines = [
        'event: message_start',
        'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[]}}',
        '',
        'event: content_block_start',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
        '',
        'event: content_block_delta',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" Claude"}}',
        '',
        'event: content_block_stop',
        'data: {"type":"content_block_stop","index":0}',
        '',
        'event: message_stop',
        'data: {"type":"message_stop"}',
        '',
    ]

    mock_resp = AsyncMock()
    mock_resp.status_code = 200
    mock_resp.aiter_lines = MagicMock(return_value=_async_iter(sse_lines))

    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    stream_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = MagicMock()
        mock_client.stream = MagicMock(return_value=stream_cm)
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        tokens = []
        async for token in rag_service.call_llm_stream(messages, anthropic_config):
            tokens.append(token)

    assert tokens == ["Hello", " Claude"]
    call_args = mock_client.stream.call_args
    assert "/v1/messages" in call_args[0][1]
    assert call_args[1]["headers"]["x-api-key"] == "sk-ant-test-key"
    body = call_args[1]["json"]
    assert body["stream"] is True
    assert body["system"] == "You are helpful."
    assert all(m["role"] != "system" for m in body["messages"])


@pytest.mark.asyncio
async def test_call_llm_stream_anthropic_bad_status(rag_service, anthropic_config):
    """call_llm_stream() raises on non-200 from Anthropic."""
    messages = [{"role": "user", "content": "Hi"}]
    mock_resp = AsyncMock()
    mock_resp.status_code = 401

    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=mock_resp)
    stream_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("app.services.rag_service.httpx.AsyncClient") as MockClient:
        mock_client = MagicMock()
        mock_client.stream = MagicMock(return_value=stream_cm)
        MockClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        MockClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with pytest.raises(RuntimeError, match="LLM returned status 401"):
            async for _ in rag_service.call_llm_stream(messages, anthropic_config):
                pass


# ── Helper for async iteration in tests ─────────────────────


async def _async_iter(items):
    for item in items:
        yield item
