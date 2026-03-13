"""Tests for the config system (Task 20)."""
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
import yaml
from fastapi.testclient import TestClient

from app.config import (
    AppConfig,
    EmbeddingLanguage,
    LLMProvider,
    get_config,
    load_config,
    save_config,
)
from app.main import create_app


# ── Model tests ─────────────────────────────────────────────────


class TestConfigModel:
    def test_defaults(self):
        cfg = AppConfig()
        assert cfg.llm_provider == LLMProvider.OLLAMA
        assert cfg.model_name == "llama3"
        assert cfg.base_url == "http://localhost:11434"
        assert cfg.api_key is None
        assert cfg.embedding_language == EmbeddingLanguage.ENGLISH

    def test_openai_compatible(self):
        cfg = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4o",
            base_url="https://api.openai.com/v1",
            api_key="sk-test-key",
        )
        assert cfg.llm_provider == LLMProvider.OPENAI_COMPATIBLE
        assert cfg.api_key == "sk-test-key"

    def test_enum_values(self):
        assert LLMProvider.OLLAMA == "ollama"
        assert LLMProvider.OPENAI_COMPATIBLE == "openai-compatible"
        assert EmbeddingLanguage.ENGLISH == "english"
        assert EmbeddingLanguage.CHINESE == "chinese"
        assert EmbeddingLanguage.MIXED == "mixed"

    def test_serialization_roundtrip(self):
        cfg = AppConfig(
            llm_provider=LLMProvider.OPENAI_COMPATIBLE,
            model_name="gpt-4o",
            base_url="https://api.openai.com/v1",
            api_key="sk-key",
            embedding_language=EmbeddingLanguage.CHINESE,
        )
        data = cfg.model_dump()
        restored = AppConfig(**data)
        assert restored == cfg


# ── File I/O tests ──────────────────────────────────────────────


class TestConfigFileIO:
    def test_save_and_load(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(model_name="mistral", embedding_language=EmbeddingLanguage.MIXED)

        save_config(cfg, config_path)
        assert config_path.exists()

        loaded = load_config(config_path)
        assert loaded.model_name == "mistral"
        assert loaded.embedding_language == EmbeddingLanguage.MIXED

    def test_load_missing_file_returns_defaults(self, tmp_path: Path):
        config_path = tmp_path / "nonexistent.yaml"
        cfg = load_config(config_path)
        assert cfg == AppConfig()

    def test_save_creates_parent_dirs(self, tmp_path: Path):
        config_path = tmp_path / "sub" / "dir" / "config.yaml"
        save_config(AppConfig(), config_path)
        assert config_path.exists()

    def test_yaml_content_readable(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        cfg = AppConfig(api_key="secret-key")
        save_config(cfg, config_path)

        raw = yaml.safe_load(config_path.read_text())
        assert raw["llm_provider"] == "ollama"
        assert raw["api_key"] == "secret-key"

    def test_load_partial_yaml_fills_defaults(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text("model_name: phi3\n")

        cfg = load_config(config_path)
        assert cfg.model_name == "phi3"
        assert cfg.llm_provider == LLMProvider.OLLAMA  # default

    def test_api_key_not_written_when_none(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        save_config(AppConfig(), config_path)

        raw = yaml.safe_load(config_path.read_text())
        # api_key should be present but null/None
        assert raw.get("api_key") is None


# ── get_config singleton ────────────────────────────────────────


class TestGetConfig:
    def test_get_config_returns_config(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        save_config(AppConfig(model_name="test-model"), config_path)

        cfg = get_config(config_path)
        assert cfg.model_name == "test-model"

    def test_get_config_creates_default_if_missing(self, tmp_path: Path):
        config_path = tmp_path / "nonexistent.yaml"
        cfg = get_config(config_path)
        assert cfg == AppConfig()


# ── API endpoint tests ──────────────────────────────────────────


class TestConfigEndpoints:
    @pytest.fixture()
    def client(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        app = create_app(config_path=config_path)
        return TestClient(app)

    def test_get_config(self, client: TestClient):
        resp = client.get("/config")
        assert resp.status_code == 200
        data = resp.json()
        assert data["llm_provider"] == "ollama"
        assert data["model_name"] == "llama3"
        assert data["base_url"] == "http://localhost:11434"
        assert data["api_key"] is None
        assert data["embedding_language"] == "english"

    def test_put_config(self, client: TestClient):
        resp = client.put(
            "/config",
            json={
                "llm_provider": "openai-compatible",
                "model_name": "gpt-4o",
                "base_url": "https://api.openai.com/v1",
                "api_key": "sk-test",
                "embedding_language": "chinese",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["llm_provider"] == "openai-compatible"
        assert data["model_name"] == "gpt-4o"
        assert data["api_key"] == "sk-test"

        # Verify persisted
        resp2 = client.get("/config")
        assert resp2.json()["model_name"] == "gpt-4o"

    def test_put_config_partial_update(self, client: TestClient):
        # First set full config
        client.put(
            "/config",
            json={
                "llm_provider": "ollama",
                "model_name": "llama3",
                "base_url": "http://localhost:11434",
                "embedding_language": "english",
            },
        )
        # Update only model_name
        resp = client.put(
            "/config",
            json={
                "llm_provider": "ollama",
                "model_name": "phi3",
                "base_url": "http://localhost:11434",
                "embedding_language": "english",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["model_name"] == "phi3"

    def test_put_config_invalid_provider(self, client: TestClient):
        resp = client.put(
            "/config",
            json={
                "llm_provider": "invalid-provider",
                "model_name": "foo",
                "base_url": "http://x",
                "embedding_language": "english",
            },
        )
        assert resp.status_code == 422

    def test_health_still_works(self, client: TestClient):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


class TestTestLLMEndpoint:
    @pytest.fixture()
    def client(self, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        save_config(
            AppConfig(
                llm_provider=LLMProvider.OLLAMA,
                base_url="http://localhost:11434",
                model_name="llama3",
            ),
            config_path,
        )
        app = create_app(config_path=config_path)
        return TestClient(app)

    @patch("app.routers.config.httpx.AsyncClient")
    def test_test_llm_success_ollama(self, mock_client_cls, client: TestClient):
        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"models": [{"name": "llama3"}]}

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        mock_client_cls.return_value = mock_client

        resp = client.post("/config/test-llm")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True

    @patch("app.routers.config.httpx.AsyncClient")
    def test_test_llm_connection_error(self, mock_client_cls, client: TestClient):
        import httpx

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=httpx.ConnectError("Connection refused"))

        mock_client_cls.return_value = mock_client

        resp = client.post("/config/test-llm")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert "error" in data

    @patch("app.routers.config.httpx.AsyncClient")
    def test_test_llm_openai_compatible(self, mock_client_cls, tmp_path: Path):
        config_path = tmp_path / "config.yaml"
        save_config(
            AppConfig(
                llm_provider=LLMProvider.OPENAI_COMPATIBLE,
                base_url="https://api.openai.com/v1",
                model_name="gpt-4o",
                api_key="sk-test",
            ),
            config_path,
        )
        app = create_app(config_path=config_path)
        test_client = TestClient(app)

        mock_response = AsyncMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"data": [{"id": "gpt-4o"}]}

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        mock_client_cls.return_value = mock_client

        resp = test_client.post("/config/test-llm")
        assert resp.status_code == 200
        assert resp.json()["success"] is True
