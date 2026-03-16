"""Multi-query expansion service — generates query variants for improved retrieval."""
import logging
import re

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import AppConfig
from app.services.llm_factory import create_chat_model

logger = logging.getLogger(__name__)

MULTI_QUERY_PROMPT = (
    "Generate 3 to 5 different versions of the following question. "
    "Each version should approach the topic from a different angle or use different terminology, "
    "but all should seek the same information. "
    "Output each variant on its own line, numbered (1. 2. 3. etc.). "
    "Do not include any other text.\n\n"
    "Original question: {question}"
)


async def expand_queries(question: str, config: AppConfig) -> list[str]:
    """Generate query variants for multi-query retrieval.

    Returns a list of query strings (including the original).
    Falls back to [question] on any error.
    """
    try:
        model = create_chat_model(config)
        messages = [
            SystemMessage(content="You generate search query variants."),
            HumanMessage(content=MULTI_QUERY_PROMPT.format(question=question)),
        ]
        response = await model.ainvoke(messages)
        content = response.content
        if not content or not content.strip():
            return [question]
        variants = _parse_numbered_lines(content.strip())
        if not variants:
            return [question]
        # Always include the original question
        if question not in variants:
            variants.insert(0, question)
        return variants
    except Exception:
        logger.warning("Multi-query expansion failed, falling back to original question", exc_info=True)
        return [question]


def _parse_numbered_lines(text: str) -> list[str]:
    """Parse numbered lines like '1. query text' from LLM output."""
    lines = []
    for line in text.strip().splitlines():
        line = line.strip()
        # Match lines starting with a number followed by . or )
        match = re.match(r"^\d+[.)]\s*(.+)$", line)
        if match:
            lines.append(match.group(1).strip())
    return lines
