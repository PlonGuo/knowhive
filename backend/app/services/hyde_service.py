"""HyDE (Hypothetical Document Embeddings) service.

Generates a hypothetical document passage that answers the question,
then uses that passage for retrieval instead of the raw question.
This improves retrieval quality because the hypothetical document is
semantically closer to actual relevant documents in the vector store.
"""
import logging

from langchain_core.messages import HumanMessage, SystemMessage

from app.config import AppConfig
from app.services.llm_factory import create_chat_model

logger = logging.getLogger(__name__)

HYDE_PROMPT_TEMPLATE = (
    "Please write a short passage (2-4 sentences) that directly answers "
    "the following question. Write as if you are quoting from a relevant "
    "document. Do not include any preamble or explanation — just the passage.\n\n"
    "Question: {question}"
)


async def generate_hypothetical_doc(question: str, config: AppConfig) -> str:
    """Generate a hypothetical document passage for the given question.

    Uses the configured LLM to generate a passage that would answer the
    question. Falls back to the original question on any error.
    """
    try:
        model = create_chat_model(config)
        messages = [
            SystemMessage(content="You generate short, factual document passages."),
            HumanMessage(content=HYDE_PROMPT_TEMPLATE.format(question=question)),
        ]
        response = await model.ainvoke(messages)
        content = response.content
        if not content or not content.strip():
            return question
        return content.strip()
    except Exception:
        logger.warning("HyDE generation failed, falling back to original question", exc_info=True)
        return question
