"""Tests for embedding API — GET /embedding/models, POST /embedding/download, GET /embedding/status."""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import EmbeddingLanguage
from app.routers.embedding import router, init_embedding_router, _reset_embedding_router


@pytest.fixture(autouse=True)
def _reset():
    _reset_embedding_router()
    yield
    _reset_embedding_router()


def _make_service(english_downloaded=False, chinese_downloaded=False, mixed_downloaded=False):
    svc = MagicMock()
    svc.get_available_models.return_value = [
        {"language": "english", "name": "all-MiniLM-L6-v2", "size_mb": 80, "downloaded": english_downloaded},
        {"language": "chinese", "name": "shibing624/text2vec-base-chinese", "size_mb": 400, "downloaded": chinese_downloaded},
        {"language": "mixed", "name": "BAAI/bge-m3", "size_mb": 1200, "downloaded": mixed_downloaded},
    ]
    svc.get_download_status.return_value = None
    svc.download_model = AsyncMock()
    return svc


def _create_app(svc=None):
    app = FastAPI()
    app.include_router(router)
    if svc is not None:
        init_embedding_router(svc)
    return app


class TestGetModels:
    def test_returns_model_list(self):
        svc = _make_service()
        client = TestClient(_create_app(svc))
        resp = client.get("/embedding/models")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        assert len(data) == 3

    def test_model_entries_have_required_fields(self):
        svc = _make_service(english_downloaded=True)
        client = TestClient(_create_app(svc))
        resp = client.get("/embedding/models")
        for m in resp.json():
            assert "language" in m
            assert "name" in m
            assert "size_mb" in m
            assert "downloaded" in m

    def test_downloaded_flag_reflected(self):
        svc = _make_service(english_downloaded=True)
        client = TestClient(_create_app(svc))
        resp = client.get("/embedding/models")
        english = next(m for m in resp.json() if m["language"] == "english")
        assert english["downloaded"] is True

    def test_503_when_not_initialized(self):
        client = TestClient(_create_app(svc=None))
        resp = client.get("/embedding/models")
        assert resp.status_code == 503


class TestPostDownload:
    def test_starts_download_for_valid_language(self):
        svc = _make_service()
        client = TestClient(_create_app(svc))
        resp = client.post("/embedding/download", json={"language": "english"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "started"
        assert data["language"] == "english"

    def test_400_for_invalid_language(self):
        svc = _make_service()
        client = TestClient(_create_app(svc))
        resp = client.post("/embedding/download", json={"language": "klingon"})
        assert resp.status_code == 422 or resp.status_code == 400

    def test_503_when_not_initialized(self):
        client = TestClient(_create_app(svc=None))
        resp = client.post("/embedding/download", json={"language": "english"})
        assert resp.status_code == 503


class TestGetStatus:
    def test_returns_none_when_no_download(self):
        svc = _make_service()
        svc.get_download_status.return_value = None
        client = TestClient(_create_app(svc))
        resp = client.get("/embedding/status?language=english")
        assert resp.status_code == 200
        assert resp.json()["status"] is None

    def test_returns_download_progress(self):
        svc = _make_service()
        svc.get_download_status.return_value = {"status": "downloading", "progress": 0.5}
        client = TestClient(_create_app(svc))
        resp = client.get("/embedding/status?language=english")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "downloading"
        assert data["progress"] == pytest.approx(0.5)

    def test_503_when_not_initialized(self):
        client = TestClient(_create_app(svc=None))
        resp = client.get("/embedding/status?language=english")
        assert resp.status_code == 503
