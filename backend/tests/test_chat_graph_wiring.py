"""Tests for chat router LangGraph wiring — _chat_stream uses prep graph."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage

from app.config import AppConfig
from app.database import close_db, get_db, init_db
from app.main import create_app
from app.services.rag_service import RAGService


# ── Fixtures ──────────────────────────────────────────────────


@pytest_asyncio.fixture
async def db():
    await init_db(":memory:")
    async with get_db() as conn:
        yield conn
    await close_db()


@pytest.fixture
def app(db, tmp_path):
    config_path = tmp_path / "config.yaml"
    return create_app(config_path=config_path)


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def mock_rag_service():
    svc = MagicMock()
    svc.retrieve.return_value = [
        {"content": "Test chunk", "file_path": "docs/test.md", "chunk_index": 0},
    ]
    svc.extract_sources.return_value = ["docs/test.md"]
    svc.build_prompt.return_value = [
        {"role": "system", "content": "system prompt"},
        {"role": "user", "content": "question"},
    ]
    return svc


def _parse_sse(text: str) -> list[dict]:
    events = []
    current_event = None
    current_data = None
    for line in text.split("\n"):
        if line.startswith("event: "):
            current_event = line[7:]
        elif line.startswith("data: "):
            current_data = line[6:]
        elif line == "" and current_event is not None:
            events.append({"event": current_event, "data": current_data})
            current_event = None
            current_data = None
    if current_event is not None and current_data is not None:
        events.append({"event": current_event, "data": current_data})
    return events


# ── Graph wiring tests ───────────────────────────────────────


@patch("app.routers.chat._get_rag_service")
@patch("app.routers.chat._get_config")
def test_chat_stream_uses_prep_graph(mock_config, mock_rag, client, mock_rag_service):
    """_chat_stream uses create_rag_prep_graph for retrieval + prompt building."""
    mock_config.return_value = AppConfig()
    mock_rag.return_value = mock_rag_service

    async def fake_stream(messages, config):
        yield "Answer"

    mock_rag_service.call_llm_stream = fake_stream

    with patch("app.routers.chat.create_rag_prep_graph") as mock_create:
        # Set up mock graph that returns expected state
        mock_graph = AsyncMock()
        mock_graph.ainvoke.return_value = {
            "question": "test",
            "k": 5,
            "chunks": [{"content": "chunk", "file_path": "docs/test.md", "chunk_index": 0}],
            "sources": ["docs/test.md"],
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "test"},
            ],
        }
        mock_create.return_value = mock_graph

        resp = client.post("/chat", json={"question": "test"})
        assert resp.status_code == 200

        # Verify prep graph was created with the rag service and config
        mock_create.assert_called_once_with(mock_rag_service, mock_config.return_value)
        # Verify graph was invoked with question and k
        mock_graph.ainvoke.assert_called_once_with({"question": "test", "k": 5})


@patch("app.routers.chat._get_rag_service")
@patch("app.routers.chat._get_config")
def test_chat_stream_passes_k_to_graph(mock_config, mock_rag, client, mock_rag_service):
    """_chat_stream passes custom k to the prep graph."""
    mock_config.return_value = AppConfig()
    mock_rag.return_value = mock_rag_service

    async def fake_stream(messages, config):
        yield "Answer"

    mock_rag_service.call_llm_stream = fake_stream

    with patch("app.routers.chat.create_rag_prep_graph") as mock_create:
        mock_graph = AsyncMock()
        mock_graph.ainvoke.return_value = {
            "question": "test",
            "k": 3,
            "chunks": [],
            "sources": [],
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "test"},
            ],
        }
        mock_create.return_value = mock_graph

        resp = client.post("/chat", json={"question": "test", "k": 3})
        assert resp.status_code == 200

        mock_graph.ainvoke.assert_called_once_with({"question": "test", "k": 3})


@patch("app.routers.chat._get_rag_service")
@patch("app.routers.chat._get_config")
def test_chat_stream_sources_from_graph(mock_config, mock_rag, client, mock_rag_service):
    """SSE sources event uses sources from the prep graph result."""
    mock_config.return_value = AppConfig()
    mock_rag.return_value = mock_rag_service

    async def fake_stream(messages, config):
        yield "Answer"

    mock_rag_service.call_llm_stream = fake_stream

    resp = client.post("/chat", json={"question": "test"})
    assert resp.status_code == 200

    events = _parse_sse(resp.text)
    source_events = [e for e in events if e["event"] == "sources"]
    assert len(source_events) == 1
    assert json.loads(source_events[0]["data"])["sources"] == ["docs/test.md"]


def test_prep_graph_import():
    """create_rag_prep_graph can be imported from rag_graph module."""
    from app.services.rag_graph import create_rag_prep_graph
    assert callable(create_rag_prep_graph)


@pytest.mark.asyncio
async def test_prep_graph_returns_no_answer():
    """Prep graph returns state without answer (no generate node)."""
    from app.services.rag_graph import create_rag_prep_graph

    coll = MagicMock()
    coll.query.return_value = {
        "ids": [["id1"]],
        "documents": [["chunk text"]],
        "metadatas": [[{"file_path": "docs/a.md", "chunk_index": 0}]],
        "distances": [[0.1]],
    }
    svc = RAGService.__new__(RAGService)
    svc._collection = coll
    svc._langfuse = None

    graph = create_rag_prep_graph(svc)
    result = await graph.ainvoke({"question": "test", "k": 5})

    assert "chunks" in result
    assert "sources" in result
    assert "messages" in result
    assert "answer" not in result


@pytest.mark.asyncio
async def test_prep_graph_messages_are_valid():
    """Prep graph produces messages suitable for LLM streaming."""
    from app.services.rag_graph import create_rag_prep_graph

    coll = MagicMock()
    coll.query.return_value = {
        "ids": [["id1"]],
        "documents": [["Python is great."]],
        "metadatas": [[{"file_path": "docs/py.md", "chunk_index": 0}]],
        "distances": [[0.1]],
    }
    svc = RAGService.__new__(RAGService)
    svc._collection = coll
    svc._langfuse = None

    graph = create_rag_prep_graph(svc)
    result = await graph.ainvoke({"question": "What is Python?", "k": 5})

    assert len(result["messages"]) == 2
    assert result["messages"][0]["role"] == "system"
    assert result["messages"][1]["role"] == "user"
    assert "Python" in result["messages"][1]["content"]
