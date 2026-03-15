"""Tests for LLM factory — create_chat_model + dicts_to_messages."""
import pytest

from app.config import AppConfig, LLMProvider
from app.services.llm_factory import create_chat_model, dicts_to_messages


# ── create_chat_model tests ─────────────────────────────────


class TestCreateChatModel:
    """Test that create_chat_model returns the correct LangChain ChatModel."""

    def test_ollama_returns_chat_ollama(self):
        config = AppConfig(
            llm_provider=LLMProvider.OLLAMA,
            model_name="llama3",
            base_url="http://localhost:11434",
        )
        model = create_chat_model(config)
        from langchain_ollama import ChatOllama

        assert isinstance(model, ChatOllama)

    def test_ollama_model_name(self):
        config = AppConfig(
            llm_provider=LLMProvider.OLLAMA,
            model_name="mistral",
            base_url="http://localhost:11434",
        )
        model = create_chat_model(config)
        assert model.model == "mistral"

    def test_ollama_base_url(self):
        config = AppConfig(
            llm_provider=LLMProvider.OLLAMA,
            model_name="llama3",
            base_url="http://myhost:11434",
        )
        model = create_chat_model(config)
        assert model.base_url == "http://myhost:11434"

    def test_openai_returns_chat_openai(self):
        config = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4",
            base_url="https://api.openai.com/v1",
            api_key="sk-test-key",
        )
        model = create_chat_model(config)
        from langchain_openai import ChatOpenAI

        assert isinstance(model, ChatOpenAI)

    def test_openai_model_name(self):
        config = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4o",
            base_url="https://api.openai.com/v1",
            api_key="sk-test",
        )
        model = create_chat_model(config)
        assert model.model_name == "gpt-4o"

    def test_openai_base_url(self):
        config = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4",
            base_url="https://custom-endpoint.com/v1",
            api_key="sk-test",
        )
        model = create_chat_model(config)
        # ChatOpenAI stores base_url in openai_api_base
        assert "custom-endpoint.com" in str(model.openai_api_base)

    def test_openai_api_key(self):
        config = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4",
            base_url="https://api.openai.com/v1",
            api_key="sk-my-secret",
        )
        model = create_chat_model(config)
        assert model.openai_api_key.get_secret_value() == "sk-my-secret"

    def test_openai_no_api_key_uses_placeholder(self):
        config = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4",
            base_url="http://localhost:1234/v1",
            api_key=None,
        )
        model = create_chat_model(config)
        # Should not raise, uses a placeholder for local endpoints
        assert model is not None

    def test_anthropic_returns_chat_anthropic(self):
        config = AppConfig(
            llm_provider=LLMProvider.ANTHROPIC,
            model_name="claude-sonnet-4-20250514",
            base_url="https://api.anthropic.com",
            api_key="sk-ant-test",
        )
        model = create_chat_model(config)
        from langchain_anthropic import ChatAnthropic

        assert isinstance(model, ChatAnthropic)

    def test_anthropic_model_name(self):
        config = AppConfig(
            llm_provider=LLMProvider.ANTHROPIC,
            model_name="claude-sonnet-4-20250514",
            base_url="https://api.anthropic.com",
            api_key="sk-ant-test",
        )
        model = create_chat_model(config)
        assert model.model == "claude-sonnet-4-20250514"

    def test_anthropic_api_key(self):
        config = AppConfig(
            llm_provider=LLMProvider.ANTHROPIC,
            model_name="claude-sonnet-4-20250514",
            base_url="https://api.anthropic.com",
            api_key="sk-ant-my-key",
        )
        model = create_chat_model(config)
        assert model.anthropic_api_key.get_secret_value() == "sk-ant-my-key"

    def test_anthropic_custom_base_url(self):
        config = AppConfig(
            llm_provider=LLMProvider.ANTHROPIC,
            model_name="claude-sonnet-4-20250514",
            base_url="https://my-proxy.com",
            api_key="sk-ant-test",
        )
        model = create_chat_model(config)
        assert "my-proxy.com" in str(model.anthropic_api_url)

    def test_unknown_provider_raises(self):
        config = AppConfig(
            llm_provider=LLMProvider.OLLAMA,
            model_name="test",
        )
        # Monkey-patch to simulate unknown provider
        config.llm_provider = "unknown"  # type: ignore
        with pytest.raises(ValueError, match="Unsupported LLM provider"):
            create_chat_model(config)


# ── dicts_to_messages tests ──────────────────────────────────


class TestDictsToMessages:
    """Test dict-to-LangChain message conversion."""

    def test_system_message(self):
        from langchain_core.messages import SystemMessage

        result = dicts_to_messages([{"role": "system", "content": "You are helpful."}])
        assert len(result) == 1
        assert isinstance(result[0], SystemMessage)
        assert result[0].content == "You are helpful."

    def test_user_message(self):
        from langchain_core.messages import HumanMessage

        result = dicts_to_messages([{"role": "user", "content": "Hello"}])
        assert len(result) == 1
        assert isinstance(result[0], HumanMessage)
        assert result[0].content == "Hello"

    def test_assistant_message(self):
        from langchain_core.messages import AIMessage

        result = dicts_to_messages([{"role": "assistant", "content": "Hi there"}])
        assert len(result) == 1
        assert isinstance(result[0], AIMessage)
        assert result[0].content == "Hi there"

    def test_mixed_messages(self):
        from langchain_core.messages import AIMessage, HumanMessage, SystemMessage

        msgs = [
            {"role": "system", "content": "System prompt"},
            {"role": "user", "content": "Question"},
            {"role": "assistant", "content": "Answer"},
        ]
        result = dicts_to_messages(msgs)
        assert len(result) == 3
        assert isinstance(result[0], SystemMessage)
        assert isinstance(result[1], HumanMessage)
        assert isinstance(result[2], AIMessage)

    def test_empty_list(self):
        result = dicts_to_messages([])
        assert result == []

    def test_unknown_role_raises(self):
        with pytest.raises(ValueError, match="Unknown message role"):
            dicts_to_messages([{"role": "tool", "content": "data"}])

    def test_preserves_content_exactly(self):
        content = "Line 1\nLine 2\n\nSpecial chars: <>&\"'"
        result = dicts_to_messages([{"role": "user", "content": content}])
        assert result[0].content == content
