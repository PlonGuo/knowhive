"""Configuration system for KnowHive — YAML-based config read/write."""
from enum import StrEnum
from pathlib import Path
from typing import Optional

import yaml
from pydantic import BaseModel


class LLMProvider(StrEnum):
    OLLAMA = "ollama"
    OPENAI_COMPATIBLE = "openai-compatible"
    ANTHROPIC = "anthropic"


class EmbeddingLanguage(StrEnum):
    ENGLISH = "english"
    CHINESE = "chinese"
    MIXED = "mixed"


class AppConfig(BaseModel):
    llm_provider: LLMProvider = LLMProvider.OLLAMA
    model_name: str = "llama3"
    base_url: str = "http://localhost:11434"
    api_key: Optional[str] = None
    embedding_language: EmbeddingLanguage = EmbeddingLanguage.ENGLISH
    first_run_complete: bool = False
    use_hyde: bool = False


def load_config(config_path: Path) -> AppConfig:
    """Load config from YAML file. Returns defaults if file doesn't exist."""
    if not config_path.exists():
        return AppConfig()
    raw = yaml.safe_load(config_path.read_text()) or {}
    return AppConfig(**raw)


def save_config(config: AppConfig, config_path: Path) -> None:
    """Save config to YAML file, creating parent dirs if needed."""
    config_path.parent.mkdir(parents=True, exist_ok=True)
    data = config.model_dump(mode="json")
    config_path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))


def get_config(config_path: Path) -> AppConfig:
    """Get config, creating default file if it doesn't exist."""
    return load_config(config_path)
