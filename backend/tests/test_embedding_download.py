"""Tests for EmbeddingService download with progress tracking."""
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.config import EmbeddingLanguage
from app.services.embedding_service import EmbeddingService, MODEL_REGISTRY


@pytest.fixture
def svc(tmp_path):
    return EmbeddingService(models_dir=tmp_path)


# ── download_model ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_download_model_sets_progress_downloading(svc):
    """download_model sets status to 'downloading' before download completes."""
    progress_states = []

    def fake_load(model_name, cache_folder):
        progress_states.append(dict(svc._download_progress.get(EmbeddingLanguage.ENGLISH, {})))

    with patch("app.services.embedding_service.SentenceTransformer", side_effect=fake_load):
        await svc.download_model(EmbeddingLanguage.ENGLISH)

    assert any(s.get("status") == "downloading" for s in progress_states)


@pytest.mark.asyncio
async def test_download_model_sets_progress_complete(svc, tmp_path):
    """After download, status becomes 'complete'."""
    def fake_load(model_name, cache_folder):
        pass  # simulate success

    with patch("app.services.embedding_service.SentenceTransformer", side_effect=fake_load):
        await svc.download_model(EmbeddingLanguage.ENGLISH)

    status = svc.get_download_status(EmbeddingLanguage.ENGLISH)
    assert status is not None
    assert status["status"] == "complete"
    assert status["progress"] == 1.0


@pytest.mark.asyncio
async def test_download_model_sets_progress_error_on_failure(svc):
    """If download throws, status becomes 'error'."""
    def fail_load(model_name, cache_folder):
        raise RuntimeError("network error")

    with patch("app.services.embedding_service.SentenceTransformer", side_effect=fail_load):
        with pytest.raises(RuntimeError):
            await svc.download_model(EmbeddingLanguage.ENGLISH)

    status = svc.get_download_status(EmbeddingLanguage.ENGLISH)
    assert status is not None
    assert status["status"] == "error"


@pytest.mark.asyncio
async def test_download_model_uses_correct_model_name(svc):
    """download_model passes the correct model name from MODEL_REGISTRY."""
    captured = {}

    def fake_load(model_name, cache_folder):
        captured["model_name"] = model_name

    with patch("app.services.embedding_service.SentenceTransformer", side_effect=fake_load):
        await svc.download_model(EmbeddingLanguage.CHINESE)

    assert captured["model_name"] == MODEL_REGISTRY[EmbeddingLanguage.CHINESE]["name"]


@pytest.mark.asyncio
async def test_download_model_saves_to_models_dir(svc, tmp_path):
    """download_model passes models_dir as cache_folder."""
    captured = {}

    def fake_load(model_name, cache_folder):
        captured["cache_folder"] = cache_folder

    with patch("app.services.embedding_service.SentenceTransformer", side_effect=fake_load):
        await svc.download_model(EmbeddingLanguage.ENGLISH)

    assert str(tmp_path) in str(captured["cache_folder"])


@pytest.mark.asyncio
async def test_download_model_runs_in_thread(svc):
    """download_model uses asyncio.to_thread (non-blocking)."""
    call_thread_id = {}

    def fake_load(model_name, cache_folder):
        import threading
        call_thread_id["id"] = threading.current_thread().ident

    import threading
    main_thread_id = threading.current_thread().ident

    with patch("app.services.embedding_service.SentenceTransformer", side_effect=fake_load):
        await svc.download_model(EmbeddingLanguage.ENGLISH)

    # Should run in a different thread than the main thread
    assert call_thread_id["id"] != main_thread_id


# ── get_download_status ───────────────────────────────────────────────────────

def test_get_download_status_returns_none_initially(svc):
    assert svc.get_download_status(EmbeddingLanguage.MIXED) is None


def test_get_download_status_reflects_in_progress(svc):
    svc._download_progress[EmbeddingLanguage.MIXED] = {"status": "downloading", "progress": 0.3}
    s = svc.get_download_status(EmbeddingLanguage.MIXED)
    assert s["status"] == "downloading"
    assert s["progress"] == pytest.approx(0.3)
