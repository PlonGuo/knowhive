"""Memory compression service — summarize conversation history for layered memory."""
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import AppConfig
from app.database import get_db
from app.services.llm_factory import create_chat_model

logger = logging.getLogger(__name__)

SUMMARIZE_SYSTEM_PROMPT = (
    "You are a conversation summarizer. Given a sequence of chat messages, "
    "produce a concise summary that captures the key topics discussed, "
    "questions asked, and answers provided. Focus on information that would "
    "be useful context for future questions. Write in third person."
)

SUMMARIZE_USER_PROMPT = "Summarize the following conversation:\n\n{conversation}"


def _format_messages(messages: list[dict[str, str]]) -> str:
    """Format message dicts into a readable conversation transcript."""
    lines = []
    for msg in messages:
        role = msg["role"].capitalize()
        lines.append(f"{role}: {msg['content']}")
    return "\n".join(lines)


async def summarize_messages(
    messages: list[dict[str, str]], config: AppConfig
) -> str:
    """Summarize a list of chat messages using the LLM.

    Args:
        messages: List of {"role": ..., "content": ...} dicts.
        config: App configuration for LLM access.

    Returns:
        A concise summary string. Falls back to empty string on error.
    """
    if not messages:
        return ""

    try:
        model = create_chat_model(config)
        conversation = _format_messages(messages)
        lc_messages = [
            SystemMessage(content=SUMMARIZE_SYSTEM_PROMPT),
            HumanMessage(content=SUMMARIZE_USER_PROMPT.format(conversation=conversation)),
        ]
        response = await model.ainvoke(lc_messages)
        content = response.content
        if not content or not content.strip():
            return ""
        return content.strip()
    except Exception:
        logger.warning("Message summarization failed, returning empty summary", exc_info=True)
        return ""


async def compress_if_needed(config: AppConfig) -> bool:
    """Check if unsummarized messages exceed threshold and compress if so.

    Uses MAX(last_message_id) from chat_summaries as the watermark.
    Messages with id > watermark are unsummarized. If their count exceeds
    config.memory_compression_threshold, summarize and INSERT a new row.

    Args:
        config: App configuration (threshold + LLM access).

    Returns:
        True if compression was performed, False otherwise.
    """
    threshold = config.memory_compression_threshold
    if threshold <= 0:
        return False

    try:
        async with get_db() as db:
            # Find watermark: MAX(last_message_id) from existing summaries
            cursor = await db.execute(
                "SELECT COALESCE(MAX(last_message_id), 0) AS watermark FROM chat_summaries"
            )
            row = await cursor.fetchone()
            watermark = row["watermark"]

            # Count unsummarized messages
            cursor = await db.execute(
                "SELECT COUNT(*) AS cnt FROM chat_messages WHERE id > ?",
                (watermark,),
            )
            row = await cursor.fetchone()
            unsummarized_count = row["cnt"]

            if unsummarized_count < threshold:
                return False

            # Fetch unsummarized messages
            cursor = await db.execute(
                "SELECT id, role, content FROM chat_messages WHERE id > ? ORDER BY id ASC",
                (watermark,),
            )
            rows = await cursor.fetchall()
            messages = [{"role": r["role"], "content": r["content"]} for r in rows]
            first_id = rows[0]["id"]
            last_id = rows[-1]["id"]

        # Summarize outside the DB context (LLM call may be slow)
        summary = await summarize_messages(messages, config)
        if not summary:
            logger.warning("Compression produced empty summary, skipping INSERT")
            return False

        # Insert summary row
        async with get_db() as db:
            await db.execute(
                "INSERT INTO chat_summaries (summary, first_message_id, last_message_id) "
                "VALUES (?, ?, ?)",
                (summary, first_id, last_id),
            )
            await db.commit()

        logger.info(
            "Compressed %d messages (id %d–%d) into summary",
            unsummarized_count, first_id, last_id,
        )
        return True

    except Exception:
        logger.warning("compress_if_needed failed", exc_info=True)
        return False
