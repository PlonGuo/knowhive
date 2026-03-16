"""Tests for RerankerService — CrossEncoder download/load and rerank."""
import asyncio
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from app.services.reranker_service import (
    RERANKER_MODEL,
    RERANKER_SIZE_MB,
    RerankerService,
)


@pytest.fixture
def tmp_models_dir(tmp_path):
    return tmp_path / "reranker_models"


@pytest.fixture
def service(tmp_models_dir):
    return RerankerService(models_dir=tmp_models_dir)


# ── Model status ──────────────────────────────────────────


def test_not_downloaded_initially(service):
    assert service.is_model_downloaded() is False


def test_downloaded_when_dir_has_files(service, tmp_models_dir):
    local_name = RERANKER_MODEL.split("/")[-1]
    model_dir = tmp_models_dir / local_name
    model_dir.mkdir(parents=True)
    (model_dir / "config.json").write_text("{}")
    assert service.is_model_downloaded() is True


def test_not_downloaded_when_dir_empty(service, tmp_models_dir):
    local_name = RERANKER_MODEL.split("/")[-1]
    model_dir = tmp_models_dir / local_name
    model_dir.mkdir(parents=True)
    assert service.is_model_downloaded() is False


def test_get_status(service):
    status = service.get_status()
    assert status["model"] == RERANKER_MODEL
    assert status["size_mb"] == RERANKER_SIZE_MB
    assert status["downloaded"] is False
    assert status["loaded"] is False


def test_get_status_loaded(service):
    service._model = MagicMock()
    status = service.get_status()
    assert status["loaded"] is True


def test_download_status_none_initially(service):
    assert service.get_download_status() is None


# ── Download ──────────────────────────────────────────────


@pytest.mark.asyncio
async def test_download_model_success(service, tmp_models_dir):
    mock_model = MagicMock()
    with patch("sentence_transformers.CrossEncoder", return_value=mock_model) as mock_ce:
        await service.download_model()

    mock_ce.assert_called_once_with(RERANKER_MODEL, cache_folder=str(tmp_models_dir))
    assert service._model is mock_model
    assert service._download_progress == {"status": "complete", "progress": 1.0}


@pytest.mark.asyncio
async def test_download_model_error(service):
    with patch("sentence_transformers.CrossEncoder", side_effect=RuntimeError("download failed")):
        with pytest.raises(RuntimeError, match="download failed"):
            await service.download_model()

    assert service._download_progress["status"] == "error"
    assert "download failed" in service._download_progress["error"]


@pytest.mark.asyncio
async def test_download_progress_during_download(service):
    """Verify progress is set to downloading before CrossEncoder is called."""
    progress_snapshots = []

    def capture_progress(*args, **kwargs):
        progress_snapshots.append(dict(service._download_progress))
        return MagicMock()

    with patch("sentence_transformers.CrossEncoder", side_effect=capture_progress):
        await service.download_model()

    assert len(progress_snapshots) == 1
    assert progress_snapshots[0]["status"] == "downloading"


# ── Load model ────────────────────────────────────────────


def test_load_model(service, tmp_models_dir):
    mock_model = MagicMock()
    with patch("sentence_transformers.CrossEncoder", return_value=mock_model) as mock_ce:
        service.load_model()

    mock_ce.assert_called_once_with(RERANKER_MODEL, cache_folder=str(tmp_models_dir))
    assert service._model is mock_model


# ── Rerank ────────────────────────────────────────────────


def test_rerank_not_loaded_raises(service):
    with pytest.raises(RuntimeError, match="not loaded"):
        service.rerank("query", [{"content": "doc"}])


def test_rerank_empty_chunks(service):
    service._model = MagicMock()
    result = service.rerank("query", [])
    assert result == []


def test_rerank_returns_top_k(service):
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.1, 0.9, 0.5]
    service._model = mock_model

    chunks = [
        {"content": "low relevance", "file_path": "a.md", "chunk_index": 0},
        {"content": "high relevance", "file_path": "b.md", "chunk_index": 0},
        {"content": "mid relevance", "file_path": "c.md", "chunk_index": 0},
    ]
    result = service.rerank("query", chunks, top_k=2)

    assert len(result) == 2
    assert result[0]["content"] == "high relevance"
    assert result[1]["content"] == "mid relevance"


def test_rerank_adds_score(service):
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.7]
    service._model = mock_model

    chunks = [{"content": "doc", "file_path": "a.md", "chunk_index": 0}]
    result = service.rerank("query", chunks)

    assert "rerank_score" in result[0]
    assert result[0]["rerank_score"] == pytest.approx(0.7)


def test_rerank_preserves_chunk_fields(service):
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.5]
    service._model = mock_model

    chunks = [{"content": "doc", "file_path": "x.md", "chunk_index": 3, "extra": "data"}]
    result = service.rerank("query", chunks)

    assert result[0]["file_path"] == "x.md"
    assert result[0]["chunk_index"] == 3
    assert result[0]["extra"] == "data"


def test_rerank_predict_called_with_pairs(service):
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.5, 0.8]
    service._model = mock_model

    chunks = [
        {"content": "doc1", "file_path": "a.md", "chunk_index": 0},
        {"content": "doc2", "file_path": "b.md", "chunk_index": 0},
    ]
    service.rerank("test query", chunks)

    mock_model.predict.assert_called_once_with([
        ["test query", "doc1"],
        ["test query", "doc2"],
    ])


def test_rerank_sorted_descending(service):
    mock_model = MagicMock()
    mock_model.predict.return_value = [0.2, 0.8, 0.5, 0.1]
    service._model = mock_model

    chunks = [
        {"content": f"doc{i}", "file_path": f"{i}.md", "chunk_index": 0}
        for i in range(4)
    ]
    result = service.rerank("query", chunks, top_k=4)

    scores = [r["rerank_score"] for r in result]
    assert scores == sorted(scores, reverse=True)


def test_rerank_top_k_default(service):
    """Default top_k=5 returns at most 5 chunks."""
    mock_model = MagicMock()
    mock_model.predict.return_value = [float(i) / 10 for i in range(8)]
    service._model = mock_model

    chunks = [
        {"content": f"doc{i}", "file_path": f"{i}.md", "chunk_index": 0}
        for i in range(8)
    ]
    result = service.rerank("query", chunks)

    assert len(result) == 5


def test_models_dir_created(tmp_path):
    new_dir = tmp_path / "new_reranker_dir"
    svc = RerankerService(models_dir=new_dir)
    assert new_dir.exists()
