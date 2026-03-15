"""Tests for Phase 9 config changes (Task 121) — PreRetrievalStrategy, use_reranker, chat_memory_turns."""
from pathlib import Path

import yaml
import pytest

from app.config import (
    AppConfig,
    EmbeddingLanguage,
    LLMProvider,
    PreRetrievalStrategy,
    load_config,
    save_config,
)


class TestPreRetrievalStrategyEnum:
    def test_enum_values(self):
        assert PreRetrievalStrategy.NONE == "none"
        assert PreRetrievalStrategy.HYDE == "hyde"
        assert PreRetrievalStrategy.MULTI_QUERY == "multi_query"

    def test_enum_member_count(self):
        assert len(PreRetrievalStrategy) == 3


class TestAppConfigPhase9Defaults:
    def test_pre_retrieval_strategy_default_none(self):
        cfg = AppConfig()
        assert cfg.pre_retrieval_strategy == PreRetrievalStrategy.NONE

    def test_use_reranker_default_false(self):
        cfg = AppConfig()
        assert cfg.use_reranker is False

    def test_chat_memory_turns_default_zero(self):
        cfg = AppConfig()
        assert cfg.chat_memory_turns == 0

    def test_use_hyde_removed(self):
        """use_hyde field should no longer exist on AppConfig."""
        cfg = AppConfig()
        assert not hasattr(cfg, "use_hyde")


class TestUseHydeMigration:
    """Loading old YAML with use_hyde: true should migrate to pre_retrieval_strategy: hyde."""

    def test_use_hyde_true_migrates_to_hyde_strategy(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("use_hyde: true\n")
        cfg = load_config(config_path)
        assert cfg.pre_retrieval_strategy == PreRetrievalStrategy.HYDE

    def test_use_hyde_false_migrates_to_none_strategy(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("use_hyde: false\n")
        cfg = load_config(config_path)
        assert cfg.pre_retrieval_strategy == PreRetrievalStrategy.NONE

    def test_use_hyde_absent_defaults_to_none(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("model_name: llama3\n")
        cfg = load_config(config_path)
        assert cfg.pre_retrieval_strategy == PreRetrievalStrategy.NONE

    def test_explicit_strategy_overrides_use_hyde(self, tmp_path: Path):
        """If both use_hyde and pre_retrieval_strategy are present, strategy wins."""
        config_path = tmp_path / "config.yaml"
        config_path.write_text(
            "use_hyde: true\npre_retrieval_strategy: multi_query\n"
        )
        cfg = load_config(config_path)
        assert cfg.pre_retrieval_strategy == PreRetrievalStrategy.MULTI_QUERY

    def test_use_hyde_stripped_after_load(self, tmp_path: Path):
        """After migration, use_hyde should not be on the model."""
        config_path = tmp_path / "config.yaml"
        config_path.write_text("use_hyde: true\n")
        cfg = load_config(config_path)
        assert not hasattr(cfg, "use_hyde")


class TestAppConfigPhase9Serialization:
    def test_roundtrip_with_new_fields(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(
            pre_retrieval_strategy=PreRetrievalStrategy.MULTI_QUERY,
            use_reranker=True,
            chat_memory_turns=5,
        )
        save_config(cfg, config_path)
        loaded = load_config(config_path)
        assert loaded.pre_retrieval_strategy == PreRetrievalStrategy.MULTI_QUERY
        assert loaded.use_reranker is True
        assert loaded.chat_memory_turns == 5

    def test_yaml_output_no_use_hyde(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(pre_retrieval_strategy=PreRetrievalStrategy.HYDE)
        save_config(cfg, config_path)
        raw = yaml.safe_load(config_path.read_text())
        assert "use_hyde" not in raw
        assert raw["pre_retrieval_strategy"] == "hyde"

    def test_new_fields_in_yaml(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(use_reranker=True, chat_memory_turns=3)
        save_config(cfg, config_path)
        raw = yaml.safe_load(config_path.read_text())
        assert raw["use_reranker"] is True
        assert raw["chat_memory_turns"] == 3

    def test_explicit_construction_all_strategies(self):
        for strategy in PreRetrievalStrategy:
            cfg = AppConfig(pre_retrieval_strategy=strategy)
            assert cfg.pre_retrieval_strategy == strategy


class TestAppConfigPhase9Validation:
    def test_invalid_strategy_rejected(self):
        with pytest.raises(Exception):
            AppConfig(pre_retrieval_strategy="invalid_strategy")

    def test_chat_memory_turns_accepts_positive(self):
        cfg = AppConfig(chat_memory_turns=10)
        assert cfg.chat_memory_turns == 10

    def test_chat_memory_turns_accepts_zero(self):
        cfg = AppConfig(chat_memory_turns=0)
        assert cfg.chat_memory_turns == 0
