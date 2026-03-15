"""Query rewriter service — rewrites questions with conversation history context."""
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import AppConfig
from app.database import get_db
from app.services.llm_factory import create_chat_model

logger = logging.getLogger(__name__)

REWRITE_PROMPT = (
    "Given the conversation history below and a follow-up question, "
    "rewrite the follow-up question to be a standalone question that captures "
    "the full context. Do not answer the question — just rewrite it.\n\n"
    "Conversation history:\n{history}\n\n"
    "Follow-up question: {question}\n\n"
    "Standalone question:"
)


async def fetch_chat_history(n_turns: int) -> list[dict[str, str]]:
    """Fetch the last n_turns messages from chat_messages table.

    Returns list of {role, content} dicts ordered oldest-first.
    """
    if n_turns <= 0:
        return []
    async with get_db() as db:
        cursor = await db.execute(
            "SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT ?",
            (n_turns,),
        )
        rows = await cursor.fetchall()
    # Reverse to oldest-first
    return [{"role": row["role"], "content": row["content"]} for row in reversed(rows)]


def _format_history(history: list[dict[str, str]]) -> str:
    """Format chat history as a string for the prompt."""
    lines = []
    for msg in history:
        role = msg["role"].capitalize()
        lines.append(f"{role}: {msg['content']}")
    return "\n".join(lines)


async def rewrite_query(question: str, history: list[dict[str, str]], config: AppConfig) -> str:
    """Rewrite the question incorporating conversation history context.

    Falls back to the original question on empty history or any error.
    """
    if not history:
        return question
    try:
        model = create_chat_model(config)
        formatted = _format_history(history)
        messages = [
            SystemMessage(content="You rewrite follow-up questions into standalone questions."),
            HumanMessage(content=REWRITE_PROMPT.format(history=formatted, question=question)),
        ]
        response = await model.ainvoke(messages)
        content = response.content
        if not content or not content.strip():
            return question
        return content.strip()
    except Exception:
        logger.warning("Query rewrite failed, falling back to original question", exc_info=True)
        return question
