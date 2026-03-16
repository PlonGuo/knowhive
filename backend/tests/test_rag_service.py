"""Tests for RAG query service — Chroma retrieval, prompt assembly, LLM call."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain_core.messages import AIMessage, AIMessageChunk

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


# ── Metadata-filtered retrieval ──────────────────────────────


def test_retrieve_with_where_filter(rag_service, mock_collection):
    """retrieve() passes where dict to collection.query when provided."""
    mock_collection.query.return_value = {
        "ids": [["id1"]],
        "documents": [["Filtered chunk."]],
        "metadatas": [[{"file_path": "packs/leetcode/two-sum.md", "chunk_index": 0}]],
        "distances": [[0.1]],
    }
    where = {"pack_id": "leetcode"}
    results = rag_service.retrieve("two sum", k=3, where=where)

    mock_collection.query.assert_called_once_with(
        query_texts=["two sum"],
        n_results=3,
        where={"pack_id": "leetcode"},
    )
    assert len(results) == 1
    assert results[0]["file_path"] == "packs/leetcode/two-sum.md"


def test_retrieve_without_where_filter(rag_service, mock_collection):
    """retrieve() does not pass where kwarg when where is None (backward compat)."""
    rag_service.retrieve("test query", k=5)

    mock_collection.query.assert_called_once_with(
        query_texts=["test query"],
        n_results=5,
    )


def test_retrieve_where_none_explicit(rag_service, mock_collection):
    """retrieve(where=None) does not pass where kwarg."""
    rag_service.retrieve("test query", k=5, where=None)

    mock_collection.query.assert_called_once_with(
        query_texts=["test query"],
        n_results=5,
    )


def test_retrieve_where_complex_filter(rag_service, mock_collection):
    """retrieve() passes complex Chroma where filters."""
    mock_collection.query.return_value = {
        "ids": [["id1"]],
        "documents": [["Result"]],
        "metadatas": [[{"file_path": "a.md", "chunk_index": 0}]],
        "distances": [[0.2]],
    }
    where = {"$and": [{"pack_id": "leetcode"}, {"difficulty": "easy"}]}
    rag_service.retrieve("query", k=3, where=where)

    mock_collection.query.assert_called_once_with(
        query_texts=["query"],
        n_results=3,
        where={"$and": [{"pack_id": "leetcode"}, {"difficulty": "easy"}]},
    )


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


def test_build_prompt_with_custom_system_prompt(rag_service):
    """build_prompt() appends custom_system_prompt to system message."""
    chunks = [{"content": "Some info.", "file_path": "a.md", "chunk_index": 0}]
    messages = rag_service.build_prompt(
        "What?", chunks, custom_system_prompt="Always respond in Spanish."
    )
    system_msg = messages[0]["content"]
    assert "Always respond in Spanish." in system_msg
    # Base system prompt should still be present
    assert "knowledge base" in system_msg.lower()


def test_build_prompt_empty_custom_system_prompt(rag_service):
    """build_prompt() with empty custom_system_prompt does not alter system message."""
    chunks = [{"content": "Info.", "file_path": "a.md", "chunk_index": 0}]
    messages_default = rag_service.build_prompt("Q?", chunks)
    messages_empty = rag_service.build_prompt("Q?", chunks, custom_system_prompt="")
    assert messages_default[0]["content"] == messages_empty[0]["content"]


# ── LLM call (via LangChain) ────────────────────────────────


@pytest.mark.asyncio
async def test_call_llm_ollama(rag_service, default_config):
    """call_llm() uses LangChain ChatModel via create_chat_model."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Hello! How can I help?")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await rag_service.call_llm(messages, default_config)

    assert result == "Hello! How can I help?"
    mock_model.ainvoke.assert_called_once()


@pytest.mark.asyncio
async def test_call_llm_openai(rag_service, openai_config):
    """call_llm() works with OpenAI-compatible config via LangChain."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Hi there!")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await rag_service.call_llm(messages, openai_config)

    assert result == "Hi there!"


@pytest.mark.asyncio
async def test_call_llm_anthropic(rag_service, anthropic_config):
    """call_llm() works with Anthropic config via LangChain."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Hello from Claude!")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await rag_service.call_llm(messages, anthropic_config)

    assert result == "Hello from Claude!"


@pytest.mark.asyncio
async def test_call_llm_connection_error(rag_service, default_config):
    """call_llm() raises ConnectionError on connection failure."""
    messages = [{"role": "user", "content": "Hi"}]
    mock_model = AsyncMock()
    mock_model.ainvoke.side_effect = Exception("Connection refused")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        with pytest.raises(ConnectionError, match="LLM connection failed"):
            await rag_service.call_llm(messages, default_config)


@pytest.mark.asyncio
async def test_call_llm_non_connection_error(rag_service, default_config):
    """call_llm() re-raises non-connection errors directly."""
    messages = [{"role": "user", "content": "Hi"}]
    mock_model = AsyncMock()
    mock_model.ainvoke.side_effect = ValueError("Invalid model")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        with pytest.raises(ValueError, match="Invalid model"):
            await rag_service.call_llm(messages, default_config)


@pytest.mark.asyncio
async def test_call_llm_converts_messages(rag_service, default_config):
    """call_llm() converts dict messages to LangChain messages via dicts_to_messages."""
    messages = [
        {"role": "system", "content": "System prompt"},
        {"role": "user", "content": "User question"},
    ]
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model) as mock_factory:
        with patch("app.services.rag_service.dicts_to_messages", wraps=__import__("app.services.llm_factory", fromlist=["dicts_to_messages"]).dicts_to_messages) as mock_convert:
            result = await rag_service.call_llm(messages, default_config)

    assert result == "Answer"
    mock_convert.assert_called_once_with(messages)
    mock_factory.assert_called_once_with(default_config)


# ── LLM streaming (via LangChain) ──────────────────────────


@pytest.mark.asyncio
async def test_call_llm_stream_yields_tokens(rag_service, default_config):
    """call_llm_stream() yields content from LangChain astream chunks."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]

    async def mock_astream(lc_messages):
        yield AIMessageChunk(content="Hello")
        yield AIMessageChunk(content=" world")
        yield AIMessageChunk(content="!")

    mock_model = MagicMock()
    mock_model.astream = mock_astream

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        tokens = []
        async for token in rag_service.call_llm_stream(messages, default_config):
            tokens.append(token)

    assert tokens == ["Hello", " world", "!"]


@pytest.mark.asyncio
async def test_call_llm_stream_skips_empty(rag_service, default_config):
    """call_llm_stream() skips chunks with empty content."""
    messages = [{"role": "user", "content": "Hi"}]

    async def mock_astream(lc_messages):
        yield AIMessageChunk(content="")
        yield AIMessageChunk(content="Hello")
        yield AIMessageChunk(content="")

    mock_model = MagicMock()
    mock_model.astream = mock_astream

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        tokens = []
        async for token in rag_service.call_llm_stream(messages, default_config):
            tokens.append(token)

    assert tokens == ["Hello"]


@pytest.mark.asyncio
async def test_call_llm_stream_connection_error(rag_service, default_config):
    """call_llm_stream() raises ConnectionError on connection failure."""
    messages = [{"role": "user", "content": "Hi"}]

    async def mock_astream(lc_messages):
        raise Exception("Connection refused")
        yield  # make it a generator

    mock_model = MagicMock()
    mock_model.astream = mock_astream

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        with pytest.raises(ConnectionError, match="LLM connection failed"):
            async for _ in rag_service.call_llm_stream(messages, default_config):
                pass


@pytest.mark.asyncio
async def test_call_llm_stream_anthropic(rag_service, anthropic_config):
    """call_llm_stream() works with Anthropic config via LangChain."""
    messages = [
        {"role": "system", "content": "You are helpful."},
        {"role": "user", "content": "Hi"},
    ]

    async def mock_astream(lc_messages):
        yield AIMessageChunk(content="Hello")
        yield AIMessageChunk(content=" Claude")

    mock_model = MagicMock()
    mock_model.astream = mock_astream

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        tokens = []
        async for token in rag_service.call_llm_stream(messages, anthropic_config):
            tokens.append(token)

    assert tokens == ["Hello", " Claude"]


# ── Full query pipeline ──────────────────────────────────────


@pytest.mark.asyncio
async def test_query_full_pipeline(rag_service, mock_collection, default_config):
    """query() orchestrates retrieve → build_prompt → call_llm."""
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(
        content="Python is a programming language created by Guido."
    )

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
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
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(
        content="I don't have relevant information."
    )

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        result = await rag_service.query("Unknown topic", default_config)

    assert result["answer"] == "I don't have relevant information."
    assert result["sources"] == []


@pytest.mark.asyncio
async def test_query_custom_k(rag_service, mock_collection, default_config):
    """query() passes k to retrieve()."""
    mock_model = AsyncMock()
    mock_model.ainvoke.return_value = AIMessage(content="Answer")

    with patch("app.services.rag_service.create_chat_model", return_value=mock_model):
        await rag_service.query("test", default_config, k=10)

    mock_collection.query.assert_called_once_with(query_texts=["test"], n_results=10)
