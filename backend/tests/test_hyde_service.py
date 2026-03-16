"""Tests for HyDE (Hypothetical Document Embeddings) service."""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from langchain_core.messages import AIMessage

from app.config import AppConfig
from app.services.hyde_service import generate_hypothetical_doc, HYDE_PROMPT_TEMPLATE


# ── Fixtures ──────────────────────────────────────────────

@pytest.fixture
def config():
    return AppConfig(
        llm_provider="ollama",
        model_name="llama3",
        base_url="http://localhost:11434",
    )


# ── Unit tests ────────────────────────────────────────────

def test_hyde_prompt_template_contains_placeholder():
    """HYDE_PROMPT_TEMPLATE must contain {question} placeholder."""
    assert "{question}" in HYDE_PROMPT_TEMPLATE


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_returns_string(config):
    """generate_hypothetical_doc returns a string."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=AIMessage(content="Hypothetical answer about trees."))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        result = await generate_hypothetical_doc("What are trees?", config)
    assert isinstance(result, str)
    assert result == "Hypothetical answer about trees."


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_calls_llm_with_question(config):
    """The question is embedded in the prompt sent to the LLM."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=AIMessage(content="doc"))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        await generate_hypothetical_doc("How does photosynthesis work?", config)

    # Verify ainvoke was called once
    mock_model.ainvoke.assert_called_once()
    # The messages should contain the question
    messages = mock_model.ainvoke.call_args[0][0]
    combined_text = " ".join(m.content for m in messages)
    assert "photosynthesis" in combined_text


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_uses_create_chat_model(config):
    """Verifies create_chat_model is called with the provided config."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=AIMessage(content="doc"))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model) as mock_factory:
        await generate_hypothetical_doc("question", config)
    mock_factory.assert_called_once_with(config)


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_strips_whitespace(config):
    """Leading/trailing whitespace in LLM response is stripped."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=AIMessage(content="  padded answer  \n"))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        result = await generate_hypothetical_doc("q", config)
    assert result == "padded answer"


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_empty_response_returns_original(config):
    """If LLM returns empty content, fall back to the original question."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=AIMessage(content=""))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        result = await generate_hypothetical_doc("original question", config)
    assert result == "original question"


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_none_response_returns_original(config):
    """If LLM returns None content, fall back to the original question."""
    mock_response = MagicMock()
    mock_response.content = None
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=mock_response)
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        result = await generate_hypothetical_doc("original question", config)
    assert result == "original question"


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_llm_error_returns_original(config):
    """If the LLM call raises an exception, fall back to the original question."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(side_effect=Exception("LLM unavailable"))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        result = await generate_hypothetical_doc("fallback question", config)
    assert result == "fallback question"


@pytest.mark.asyncio
async def test_generate_hypothetical_doc_sends_system_and_human_messages(config):
    """The LLM receives a system message and a human message."""
    mock_model = AsyncMock()
    mock_model.ainvoke = AsyncMock(return_value=AIMessage(content="doc"))
    with patch("app.services.hyde_service.create_chat_model", return_value=mock_model):
        await generate_hypothetical_doc("test question", config)

    messages = mock_model.ainvoke.call_args[0][0]
    assert len(messages) == 2
    assert messages[0].__class__.__name__ == "SystemMessage"
    assert messages[1].__class__.__name__ == "HumanMessage"
