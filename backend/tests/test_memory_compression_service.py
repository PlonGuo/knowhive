"""Tests for memory compression service (Tasks 134-135)."""
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio

from app.config import AppConfig
from app.database import init_db, close_db, get_db
from app.services.memory_compression_service import (
    SUMMARIZE_SYSTEM_PROMPT,
    SUMMARIZE_USER_PROMPT,
    _format_messages,
    compress_if_needed,
    summarize_messages,
)


# ---------------------------------------------------------------------------
# _format_messages
# ---------------------------------------------------------------------------

class TestFormatMessages:
    def test_formats_user_and_assistant(self):
        messages = [
            {"role": "user", "content": "What is BFS?"},
            {"role": "assistant", "content": "BFS is breadth-first search."},
        ]
        result = _format_messages(messages)
        assert "User: What is BFS?" in result
        assert "Assistant: BFS is breadth-first search." in result

    def test_empty_list(self):
        assert _format_messages([]) == ""


# ---------------------------------------------------------------------------
# summarize_messages
# ---------------------------------------------------------------------------

class TestSummarizeMessages:
    @pytest.fixture
    def config(self):
        return AppConfig()

    @pytest.mark.asyncio
    async def test_returns_summary(self, config):
        mock_response = MagicMock()
        mock_response.content = "The user asked about BFS and received an explanation."
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            result = await summarize_messages(
                [{"role": "user", "content": "What is BFS?"}], config
            )
        assert result == "The user asked about BFS and received an explanation."

    @pytest.mark.asyncio
    async def test_empty_messages_returns_empty(self, config):
        result = await summarize_messages([], config)
        assert result == ""

    @pytest.mark.asyncio
    async def test_llm_called_with_correct_messages(self, config):
        mock_response = MagicMock()
        mock_response.content = "summary"
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        messages = [{"role": "user", "content": "Hello"}]
        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            await summarize_messages(messages, config)

        call_args = mock_model.ainvoke.call_args[0][0]
        assert len(call_args) == 2
        assert call_args[0].content == SUMMARIZE_SYSTEM_PROMPT
        assert "User: Hello" in call_args[1].content

    @pytest.mark.asyncio
    async def test_strips_whitespace(self, config):
        mock_response = MagicMock()
        mock_response.content = "  summary with spaces  \n"
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            result = await summarize_messages(
                [{"role": "user", "content": "hi"}], config
            )
        assert result == "summary with spaces"

    @pytest.mark.asyncio
    async def test_empty_response_returns_empty(self, config):
        mock_response = MagicMock()
        mock_response.content = ""
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            result = await summarize_messages(
                [{"role": "user", "content": "hi"}], config
            )
        assert result == ""

    @pytest.mark.asyncio
    async def test_none_response_returns_empty(self, config):
        mock_response = MagicMock()
        mock_response.content = None
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            result = await summarize_messages(
                [{"role": "user", "content": "hi"}], config
            )
        assert result == ""

    @pytest.mark.asyncio
    async def test_llm_error_returns_empty(self, config):
        mock_model = AsyncMock()
        mock_model.ainvoke.side_effect = RuntimeError("LLM down")

        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            result = await summarize_messages(
                [{"role": "user", "content": "hi"}], config
            )
        assert result == ""

    @pytest.mark.asyncio
    async def test_create_chat_model_called_with_config(self, config):
        mock_response = MagicMock()
        mock_response.content = "summary"
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ) as mock_factory:
            await summarize_messages(
                [{"role": "user", "content": "hi"}], config
            )
        mock_factory.assert_called_once_with(config)

    @pytest.mark.asyncio
    async def test_multi_message_conversation(self, config):
        mock_response = MagicMock()
        mock_response.content = "Multi-turn summary."
        mock_model = AsyncMock()
        mock_model.ainvoke.return_value = mock_response

        messages = [
            {"role": "user", "content": "What is DFS?"},
            {"role": "assistant", "content": "DFS is depth-first search."},
            {"role": "user", "content": "How does it differ from BFS?"},
            {"role": "assistant", "content": "BFS explores level by level."},
        ]
        with patch(
            "app.services.memory_compression_service.create_chat_model",
            return_value=mock_model,
        ):
            result = await summarize_messages(messages, config)

        assert result == "Multi-turn summary."
        call_args = mock_model.ainvoke.call_args[0][0]
        prompt_text = call_args[1].content
        assert "User: What is DFS?" in prompt_text
        assert "Assistant: DFS is depth-first search." in prompt_text
        assert "User: How does it differ from BFS?" in prompt_text


# ---------------------------------------------------------------------------
# compress_if_needed (Task 135)
# ---------------------------------------------------------------------------

class TestCompressIfNeeded:
    """Integration tests using real SQLite for compress_if_needed()."""

    @pytest_asyncio.fixture
    async def db(self, tmp_path):
        db_path = str(tmp_path / "test.db")
        await init_db(db_path)
        yield
        await close_db()

    @pytest.fixture
    def config(self):
        return AppConfig(memory_compression_threshold=5)

    async def _insert_messages(self, count: int) -> None:
        """Insert N dummy chat messages."""
        async with get_db() as db:
            for i in range(count):
                role = "user" if i % 2 == 0 else "assistant"
                await db.execute(
                    "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
                    (role, f"message {i}"),
                )
            await db.commit()

    @pytest.mark.asyncio
    async def test_below_threshold_no_compression(self, db, config):
        await self._insert_messages(3)
        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
        ) as mock_summarize:
            result = await compress_if_needed(config)
        assert result is False
        mock_summarize.assert_not_called()

    @pytest.mark.asyncio
    async def test_at_threshold_triggers_compression(self, db, config):
        await self._insert_messages(5)
        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
            return_value="Summary of 5 messages.",
        ):
            result = await compress_if_needed(config)
        assert result is True

        async with get_db() as db:
            cursor = await db.execute("SELECT * FROM chat_summaries")
            rows = await cursor.fetchall()
        assert len(rows) == 1
        assert rows[0]["summary"] == "Summary of 5 messages."
        assert rows[0]["first_message_id"] == 1
        assert rows[0]["last_message_id"] == 5

    @pytest.mark.asyncio
    async def test_above_threshold_triggers_compression(self, db, config):
        await self._insert_messages(8)
        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
            return_value="Summary.",
        ):
            result = await compress_if_needed(config)
        assert result is True

    @pytest.mark.asyncio
    async def test_watermark_respects_existing_summary(self, db, config):
        """After a summary covering messages 1-5, only messages 6+ are unsummarized."""
        await self._insert_messages(8)
        async with get_db() as db_conn:
            await db_conn.execute(
                "INSERT INTO chat_summaries (summary, first_message_id, last_message_id) "
                "VALUES (?, ?, ?)",
                ("Old summary", 1, 5),
            )
            await db_conn.commit()

        # Only 3 unsummarized (6,7,8) — below threshold of 5
        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
        ) as mock_summarize:
            result = await compress_if_needed(config)
        assert result is False
        mock_summarize.assert_not_called()

    @pytest.mark.asyncio
    async def test_watermark_triggers_when_enough_new(self, db, config):
        """After a summary covering messages 1-3, messages 4-8 (5 msgs) trigger compression."""
        await self._insert_messages(8)
        async with get_db() as db_conn:
            await db_conn.execute(
                "INSERT INTO chat_summaries (summary, first_message_id, last_message_id) "
                "VALUES (?, ?, ?)",
                ("Old summary", 1, 3),
            )
            await db_conn.commit()

        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
            return_value="New summary.",
        ):
            result = await compress_if_needed(config)
        assert result is True

        async with get_db() as db_conn:
            cursor = await db_conn.execute(
                "SELECT * FROM chat_summaries ORDER BY id"
            )
            rows = await cursor.fetchall()
        assert len(rows) == 2
        assert rows[1]["first_message_id"] == 4
        assert rows[1]["last_message_id"] == 8

    @pytest.mark.asyncio
    async def test_threshold_zero_disables(self, db):
        config = AppConfig(memory_compression_threshold=0)
        await self._insert_messages(100)
        result = await compress_if_needed(config)
        assert result is False

    @pytest.mark.asyncio
    async def test_empty_summary_skips_insert(self, db, config):
        await self._insert_messages(5)
        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
            return_value="",
        ):
            result = await compress_if_needed(config)
        assert result is False

        async with get_db() as db_conn:
            cursor = await db_conn.execute("SELECT COUNT(*) AS cnt FROM chat_summaries")
            row = await cursor.fetchone()
        assert row["cnt"] == 0

    @pytest.mark.asyncio
    async def test_no_messages_no_compression(self, db, config):
        result = await compress_if_needed(config)
        assert result is False

    @pytest.mark.asyncio
    async def test_summarize_receives_correct_messages(self, db, config):
        await self._insert_messages(5)
        with patch(
            "app.services.memory_compression_service.summarize_messages",
            new_callable=AsyncMock,
            return_value="Summary.",
        ) as mock_summarize:
            await compress_if_needed(config)

        call_args = mock_summarize.call_args
        messages = call_args[0][0]
        assert len(messages) == 5
        assert messages[0]["content"] == "message 0"
        assert messages[4]["content"] == "message 4"
        # Config passed as second arg
        assert call_args[0][1] == config
