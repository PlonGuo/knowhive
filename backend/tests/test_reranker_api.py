"""Tests for reranker API router — status, download, download-status."""
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI

from app.routers.reranker import router, init_reranker_router, _reset_reranker_router


@pytest.fixture
def mock_service():
    svc = MagicMock()
    svc.get_status.return_value = {
        "model": "cross-encoder/ms-marco-MiniLM-L-6-v2",
        "size_mb": 80,
        "downloaded": False,
        "loaded": False,
    }
    svc.get_download_status.return_value = None
    svc.download_model = AsyncMock()
    return svc


@pytest.fixture
def client(mock_service):
    app = FastAPI()
    app.include_router(router)
    init_reranker_router(mock_service)
    yield TestClient(app)
    _reset_reranker_router()


# ── GET /reranker/status ──────────────────────────────────


def test_get_status(client, mock_service):
    resp = client.get("/reranker/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["model"] == "cross-encoder/ms-marco-MiniLM-L-6-v2"
    assert data["size_mb"] == 80
    assert data["downloaded"] is False
    assert data["loaded"] is False
    mock_service.get_status.assert_called_once()


def test_get_status_downloaded(client, mock_service):
    mock_service.get_status.return_value = {
        "model": "cross-encoder/ms-marco-MiniLM-L-6-v2",
        "size_mb": 80,
        "downloaded": True,
        "loaded": True,
    }
    resp = client.get("/reranker/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["downloaded"] is True
    assert data["loaded"] is True


# ── POST /reranker/download ───────────────────────────────


def test_start_download(client, mock_service):
    resp = client.post("/reranker/download")
    assert resp.status_code == 200
    assert resp.json() == {"status": "started"}


# ── GET /reranker/download-status ─────────────────────────


def test_download_status_none(client, mock_service):
    resp = client.get("/reranker/download-status")
    assert resp.status_code == 200
    assert resp.json() == {"status": None}


def test_download_status_downloading(client, mock_service):
    mock_service.get_download_status.return_value = {"status": "downloading", "progress": 0.0}
    resp = client.get("/reranker/download-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "downloading"
    assert data["progress"] == 0.0


def test_download_status_complete(client, mock_service):
    mock_service.get_download_status.return_value = {"status": "complete", "progress": 1.0}
    resp = client.get("/reranker/download-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "complete"
    assert data["progress"] == 1.0


def test_download_status_error(client, mock_service):
    mock_service.get_download_status.return_value = {"status": "error", "progress": 0.0, "error": "fail"}
    resp = client.get("/reranker/download-status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "error"
    assert data["error"] == "fail"


# ── 503 when service not initialized ─────────────────────


def test_status_503_without_init():
    _reset_reranker_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/reranker/status")
    assert resp.status_code == 503


def test_download_503_without_init():
    _reset_reranker_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.post("/reranker/download")
    assert resp.status_code == 503


def test_download_status_503_without_init():
    _reset_reranker_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)
    resp = client.get("/reranker/download-status")
    assert resp.status_code == 503
