"""LLM factory — map AppConfig to LangChain ChatModel instances."""
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.config import AppConfig, LLMProvider


def create_chat_model(config: AppConfig) -> BaseChatModel:
    """Map AppConfig to the appropriate LangChain ChatModel."""
    if config.llm_provider == LLMProvider.OLLAMA:
        from langchain_ollama import ChatOllama

        return ChatOllama(
            model=config.model_name,
            base_url=config.base_url,
        )
    elif config.llm_provider == LLMProvider.OPENAI_COMPATIBLE:
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(
            model=config.model_name,
            base_url=config.base_url,
            api_key=config.api_key or "not-needed",
        )
    elif config.llm_provider == LLMProvider.ANTHROPIC:
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(
            model=config.model_name,
            api_key=config.api_key or "",
            anthropic_api_url=config.base_url,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {config.llm_provider}")


def dicts_to_messages(messages: list[dict]) -> list[BaseMessage]:
    """Convert {"role": "system"|"user"|"assistant", "content": "..."} dicts to LangChain message objects."""
    result: list[BaseMessage] = []
    for msg in messages:
        role = msg["role"]
        content = msg["content"]
        if role == "system":
            result.append(SystemMessage(content=content))
        elif role == "user":
            result.append(HumanMessage(content=content))
        elif role == "assistant":
            result.append(AIMessage(content=content))
        else:
            raise ValueError(f"Unknown message role: {role}")
    return result
