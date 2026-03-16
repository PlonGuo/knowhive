"""Tests for summary API router — GET /summary/file, POST /summary/generate."""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.summary import _reset_summary_router, init_summary_router, router


def make_mock_rag():
    rag = MagicMock()
    rag.call_llm = AsyncMock(return_value="mock summary")
    return rag


def make_app(summary_service, rag_service=None, config_path=None, knowledge_dir=None):
    _reset_summary_router()
    init_summary_router(
        summary_service=summary_service,
        rag_service=rag_service if rag_service is not None else make_mock_rag(),
        config_path=config_path,
        knowledge_dir=knowledge_dir,
    )
    app = FastAPI()
    app.include_router(router)
    return app


# ── GET /summary/file ─────────────────────────────────────────────────────────

def test_get_summary_returns_cached():
    svc = MagicMock()
    svc.get_cached_summary = AsyncMock(return_value="Python is a high-level language.")
    client = TestClient(make_app(svc))

    resp = client.get("/summary/file", params={"file_path": "intro.md"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"] == "Python is a high-level language."
    assert data["cached"] is True


def test_get_summary_returns_404_when_no_cache():
    svc = MagicMock()
    svc.get_cached_summary = AsyncMock(return_value=None)
    client = TestClient(make_app(svc))

    resp = client.get("/summary/file", params={"file_path": "missing.md"})
    assert resp.status_code == 404


def test_get_summary_returns_503_when_not_initialized():
    _reset_summary_router()
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)
    resp = client.get("/summary/file", params={"file_path": "intro.md"})
    assert resp.status_code == 503


# ── POST /summary/generate ────────────────────────────────────────────────────

def test_post_generate_returns_summary(tmp_path):
    svc = MagicMock()
    svc.get_or_generate = AsyncMock(return_value="A generated summary.")
    client = TestClient(make_app(svc, knowledge_dir=tmp_path))

    resp = client.post("/summary/generate", json={"file_path": "intro.md"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["summary"] == "A generated summary."


def test_post_generate_returns_404_when_file_not_found(tmp_path):
    svc = MagicMock()
    svc.get_or_generate = AsyncMock(return_value=None)
    client = TestClient(make_app(svc, knowledge_dir=tmp_path))

    resp = client.post("/summary/generate", json={"file_path": "nonexistent.md"})
    assert resp.status_code == 404


def test_post_generate_returns_503_without_rag_service():
    svc = MagicMock()
    _reset_summary_router()
    # Init without rag_service
    init_summary_router(summary_service=svc)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.post("/summary/generate", json={"file_path": "intro.md"})
    assert resp.status_code == 503


# ── POST /summary/batch ───────────────────────────────────────────────────────

def test_post_batch_returns_summaries_for_multiple_files(tmp_path):
    svc = MagicMock()
    svc.get_or_generate = AsyncMock(side_effect=["Summary A.", "Summary B."])
    client = TestClient(make_app(svc, knowledge_dir=tmp_path))

    resp = client.post("/summary/batch", json={"file_paths": ["a.md", "b.md"]})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 2


def test_post_batch_skips_null_summaries(tmp_path):
    svc = MagicMock()
    svc.get_or_generate = AsyncMock(side_effect=["Summary A.", None])
    client = TestClient(make_app(svc, knowledge_dir=tmp_path))

    resp = client.post("/summary/batch", json={"file_paths": ["a.md", "missing.md"]})
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["file_path"] == "a.md"


def test_post_batch_returns_503_without_rag():
    svc = MagicMock()
    _reset_summary_router()
    init_summary_router(summary_service=svc)
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app, raise_server_exceptions=False)

    resp = client.post("/summary/batch", json={"file_paths": ["a.md"]})
    assert resp.status_code == 503
