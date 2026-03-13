"""Tests for EmbeddingService — model registry, download status, embedding function."""
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.config import EmbeddingLanguage
from app.services.embedding_service import EmbeddingService, MODEL_REGISTRY


# ── MODEL_REGISTRY tests ──────────────────────────────────────────────────────

def test_model_registry_has_all_languages():
    assert EmbeddingLanguage.ENGLISH in MODEL_REGISTRY
    assert EmbeddingLanguage.CHINESE in MODEL_REGISTRY
    assert EmbeddingLanguage.MIXED in MODEL_REGISTRY


def test_model_registry_english_model():
    info = MODEL_REGISTRY[EmbeddingLanguage.ENGLISH]
    assert info["name"] == "all-MiniLM-L6-v2"
    assert info["size_mb"] == pytest.approx(80, abs=50)


def test_model_registry_chinese_model():
    info = MODEL_REGISTRY[EmbeddingLanguage.CHINESE]
    assert "text2vec" in info["name"].lower() or "chinese" in info["name"].lower()
    assert info["size_mb"] > 100


def test_model_registry_mixed_model():
    info = MODEL_REGISTRY[EmbeddingLanguage.MIXED]
    assert "bge" in info["name"].lower() or "m3" in info["name"].lower()
    assert info["size_mb"] > 500


# ── get_available_models ──────────────────────────────────────────────────────

def test_get_available_models_returns_all_languages(tmp_path):
    svc = EmbeddingService(models_dir=tmp_path)
    models = svc.get_available_models()
    assert len(models) == 3
    languages = {m["language"] for m in models}
    assert languages == {"english", "chinese", "mixed"}


def test_get_available_models_includes_name_and_size(tmp_path):
    svc = EmbeddingService(models_dir=tmp_path)
    models = svc.get_available_models()
    for m in models:
        assert "name" in m
        assert "size_mb" in m
        assert "language" in m
        assert "downloaded" in m


# ── is_model_downloaded ───────────────────────────────────────────────────────

def test_is_model_downloaded_false_when_dir_missing(tmp_path):
    svc = EmbeddingService(models_dir=tmp_path)
    assert svc.is_model_downloaded(EmbeddingLanguage.ENGLISH) is False


def test_is_model_downloaded_true_when_dir_exists(tmp_path):
    model_name = MODEL_REGISTRY[EmbeddingLanguage.ENGLISH]["name"]
    model_dir = tmp_path / model_name
    model_dir.mkdir()
    (model_dir / "config.json").write_text("{}")  # non-empty dir
    svc = EmbeddingService(models_dir=tmp_path)
    assert svc.is_model_downloaded(EmbeddingLanguage.ENGLISH) is True


def test_is_model_downloaded_false_for_empty_dir(tmp_path):
    model_name = MODEL_REGISTRY[EmbeddingLanguage.ENGLISH]["name"]
    (tmp_path / model_name).mkdir()
    svc = EmbeddingService(models_dir=tmp_path)
    assert svc.is_model_downloaded(EmbeddingLanguage.ENGLISH) is False


# ── _download_progress ────────────────────────────────────────────────────────

def test_download_progress_initially_empty(tmp_path):
    svc = EmbeddingService(models_dir=tmp_path)
    assert svc.get_download_status(EmbeddingLanguage.ENGLISH) is None


def test_download_progress_can_be_set(tmp_path):
    svc = EmbeddingService(models_dir=tmp_path)
    svc._download_progress[EmbeddingLanguage.ENGLISH] = {"progress": 0.5, "status": "downloading"}
    status = svc.get_download_status(EmbeddingLanguage.ENGLISH)
    assert status["progress"] == 0.5


# ── get_embedding_function ────────────────────────────────────────────────────

def test_get_embedding_function_returns_chromadb_function(tmp_path):
    """get_embedding_function returns a chromadb SentenceTransformerEmbeddingFunction."""
    svc = EmbeddingService(models_dir=tmp_path)
    with patch("app.services.embedding_service.embedding_functions") as mock_ef:
        mock_fn = MagicMock()
        mock_ef.SentenceTransformerEmbeddingFunction.return_value = mock_fn
        result = svc.get_embedding_function(EmbeddingLanguage.ENGLISH)
        mock_ef.SentenceTransformerEmbeddingFunction.assert_called_once_with(
            model_name=MODEL_REGISTRY[EmbeddingLanguage.ENGLISH]["name"]
        )
        assert result is mock_fn
