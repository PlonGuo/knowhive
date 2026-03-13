"""Tests for Chat API — POST /chat (SSE streaming), GET/DELETE /chat/history."""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from fastapi.testclient import TestClient

from app.database import close_db, get_db, init_db
from app.main import create_app


# ── Fixtures ──────────────────────────────────────────────────


@pytest_asyncio.fixture
async def db():
    """In-memory database for testing."""
    await init_db(":memory:")
    async with get_db() as conn:
        yield conn
    await close_db()


@pytest.fixture
def app(db, tmp_path):
    """Create a FastAPI test app with chat router configured."""
    config_path = tmp_path / "config.yaml"
    application = create_app(config_path=config_path)
    return application


@pytest.fixture
def client(app):
    return TestClient(app)


@pytest.fixture
def mock_rag_service():
    """Mock RAGService for chat tests."""
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


# ── POST /chat — SSE streaming ────────────────────────────────


class TestPostChat:
    def test_chat_requires_question(self, client):
        """POST /chat with empty question returns 422."""
        resp = client.post("/chat", json={"question": ""})
        assert resp.status_code == 422

    def test_chat_requires_body(self, client):
        """POST /chat with no body returns 422."""
        resp = client.post("/chat")
        assert resp.status_code == 422

    @patch("app.routers.chat._get_rag_service")
    @patch("app.routers.chat._get_config")
    def test_chat_returns_sse_stream(self, mock_config, mock_rag, client, mock_rag_service):
        """POST /chat returns text/event-stream with token, sources, done events."""
        from app.config import AppConfig

        mock_config.return_value = AppConfig()
        mock_rag.return_value = mock_rag_service

        # Mock the streaming method to yield tokens
        async def fake_stream(messages, config):
            for token in ["Hello", " world", "!"]:
                yield token

        mock_rag_service.call_llm_stream = fake_stream

        resp = client.post("/chat", json={"question": "What is Python?"})
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        # Parse SSE events
        events = _parse_sse(resp.text)

        # Should have token events
        token_events = [e for e in events if e["event"] == "token"]
        assert len(token_events) == 3
        assert json.loads(token_events[0]["data"])["token"] == "Hello"
        assert json.loads(token_events[1]["data"])["token"] == " world"
        assert json.loads(token_events[2]["data"])["token"] == "!"

        # Should have sources event
        source_events = [e for e in events if e["event"] == "sources"]
        assert len(source_events) == 1
        assert json.loads(source_events[0]["data"])["sources"] == ["docs/test.md"]

        # Should have done event
        done_events = [e for e in events if e["event"] == "done"]
        assert len(done_events) == 1

    @patch("app.routers.chat._get_rag_service")
    @patch("app.routers.chat._get_config")
    def test_chat_saves_messages_to_db(self, mock_config, mock_rag, client, mock_rag_service, db):
        """POST /chat saves user question and assistant response to chat_messages."""
        import asyncio

        from app.config import AppConfig

        mock_config.return_value = AppConfig()
        mock_rag.return_value = mock_rag_service

        async def fake_stream(messages, config):
            yield "Answer"

        mock_rag_service.call_llm_stream = fake_stream

        resp = client.post("/chat", json={"question": "test question"})
        assert resp.status_code == 200

        # Verify messages were saved
        async def check():
            async with get_db() as conn:
                cursor = await conn.execute("SELECT * FROM chat_messages ORDER BY id")
                rows = await cursor.fetchall()
                return rows

        rows = asyncio.get_event_loop().run_until_complete(check())
        assert len(rows) == 2
        assert rows[0]["role"] == "user"
        assert rows[0]["content"] == "test question"
        assert rows[1]["role"] == "assistant"
        assert rows[1]["content"] == "Answer"
        assert rows[1]["sources"] is not None

    @patch("app.routers.chat._get_rag_service")
    @patch("app.routers.chat._get_config")
    def test_chat_with_custom_k(self, mock_config, mock_rag, client, mock_rag_service):
        """POST /chat respects optional k parameter."""
        from app.config import AppConfig

        mock_config.return_value = AppConfig()
        mock_rag.return_value = mock_rag_service

        async def fake_stream(messages, config):
            yield "ok"

        mock_rag_service.call_llm_stream = fake_stream

        resp = client.post("/chat", json={"question": "test", "k": 3})
        assert resp.status_code == 200
        mock_rag_service.retrieve.assert_called_once_with("test", k=3)

    @patch("app.routers.chat._get_rag_service")
    @patch("app.routers.chat._get_config")
    def test_chat_handles_llm_error(self, mock_config, mock_rag, client, mock_rag_service):
        """POST /chat sends error event if LLM stream fails."""
        from app.config import AppConfig

        mock_config.return_value = AppConfig()
        mock_rag.return_value = mock_rag_service

        async def failing_stream(messages, config):
            yield "partial"
            raise ConnectionError("LLM down")

        mock_rag_service.call_llm_stream = failing_stream

        resp = client.post("/chat", json={"question": "test"})
        assert resp.status_code == 200

        events = _parse_sse(resp.text)
        error_events = [e for e in events if e["event"] == "error"]
        assert len(error_events) == 1
        assert "LLM down" in json.loads(error_events[0]["data"])["error"]


# ── GET /chat/history ──────────────────────────────────────────


class TestGetChatHistory:
    def test_empty_history(self, client):
        """GET /chat/history returns empty list when no messages."""
        resp = client.get("/chat/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["messages"] == []
        assert data["total"] == 0

    def test_history_with_messages(self, client, db):
        """GET /chat/history returns saved messages."""
        import asyncio

        async def seed():
            async with get_db() as conn:
                await conn.execute(
                    "INSERT INTO chat_messages (role, content, sources) VALUES (?, ?, ?)",
                    ("user", "hello", None),
                )
                await conn.execute(
                    "INSERT INTO chat_messages (role, content, sources) VALUES (?, ?, ?)",
                    ("assistant", "hi there", '["docs/a.md"]'),
                )
                await conn.commit()

        asyncio.get_event_loop().run_until_complete(seed())

        resp = client.get("/chat/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 2
        assert len(data["messages"]) == 2
        assert data["messages"][0]["role"] == "user"
        assert data["messages"][1]["role"] == "assistant"

    def test_history_with_limit(self, client, db):
        """GET /chat/history respects limit parameter."""
        import asyncio

        async def seed():
            async with get_db() as conn:
                for i in range(5):
                    await conn.execute(
                        "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
                        ("user", f"msg {i}"),
                    )
                await conn.commit()

        asyncio.get_event_loop().run_until_complete(seed())

        resp = client.get("/chat/history?limit=3")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["messages"]) == 3
        assert data["total"] == 5

    def test_history_with_offset(self, client, db):
        """GET /chat/history respects offset parameter."""
        import asyncio

        async def seed():
            async with get_db() as conn:
                for i in range(5):
                    await conn.execute(
                        "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
                        ("user", f"msg {i}"),
                    )
                await conn.commit()

        asyncio.get_event_loop().run_until_complete(seed())

        resp = client.get("/chat/history?limit=2&offset=3")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["messages"]) == 2
        assert data["total"] == 5


# ── DELETE /chat/history ──────────────────────────────────────


class TestDeleteChatHistory:
    def test_delete_empty_history(self, client):
        """DELETE /chat/history succeeds even with no messages."""
        resp = client.delete("/chat/history")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 0

    def test_delete_clears_messages(self, client, db):
        """DELETE /chat/history removes all chat messages."""
        import asyncio

        async def seed():
            async with get_db() as conn:
                await conn.execute(
                    "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
                    ("user", "hello"),
                )
                await conn.execute(
                    "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
                    ("assistant", "hi"),
                )
                await conn.commit()

        asyncio.get_event_loop().run_until_complete(seed())

        resp = client.delete("/chat/history")
        assert resp.status_code == 200
        assert resp.json()["deleted"] == 2

        # Verify empty
        resp2 = client.get("/chat/history")
        assert resp2.json()["total"] == 0


# ── SSE parsing helper ────────────────────────────────────────


def _parse_sse(text: str) -> list[dict]:
    """Parse SSE text into a list of {event, data} dicts."""
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

    # Catch last event if no trailing newline
    if current_event is not None and current_data is not None:
        events.append({"event": current_event, "data": current_data})

    return events
