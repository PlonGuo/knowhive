"""Tests for Phase 10 config changes (Task 133) — memory_compression_threshold."""
from pathlib import Path

import yaml
import pytest

from app.config import AppConfig, load_config, save_config


class TestMemoryCompressionThresholdDefault:
    def test_default_is_20(self):
        cfg = AppConfig()
        assert cfg.memory_compression_threshold == 20

    def test_zero_disables_compression(self):
        cfg = AppConfig(memory_compression_threshold=0)
        assert cfg.memory_compression_threshold == 0

    def test_custom_value(self):
        cfg = AppConfig(memory_compression_threshold=50)
        assert cfg.memory_compression_threshold == 50


class TestMemoryCompressionThresholdSerialization:
    def test_roundtrip(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(memory_compression_threshold=30)
        save_config(cfg, config_path)
        loaded = load_config(config_path)
        assert loaded.memory_compression_threshold == 30

    def test_yaml_contains_field(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(memory_compression_threshold=15)
        save_config(cfg, config_path)
        raw = yaml.safe_load(config_path.read_text())
        assert raw["memory_compression_threshold"] == 15

    def test_missing_from_yaml_uses_default(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("model_name: llama3\n")
        cfg = load_config(config_path)
        assert cfg.memory_compression_threshold == 20

    def test_zero_roundtrip(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(memory_compression_threshold=0)
        save_config(cfg, config_path)
        loaded = load_config(config_path)
        assert loaded.memory_compression_threshold == 0


class TestMemoryCompressionThresholdValidation:
    def test_negative_value_accepted(self):
        """Pydantic doesn't reject negatives by default — app logic handles semantics."""
        cfg = AppConfig(memory_compression_threshold=-1)
        assert cfg.memory_compression_threshold == -1

    def test_large_value_accepted(self):
        cfg = AppConfig(memory_compression_threshold=1000)
        assert cfg.memory_compression_threshold == 1000
