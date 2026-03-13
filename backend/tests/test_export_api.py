"""Tests for export API — POST /export/full, /export/chat, /export/file."""
import json
import zipfile
from io import BytesIO
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routers.export import router, init_export_router, _reset_export_router


@pytest.fixture(autouse=True)
def _reset():
    _reset_export_router()
    yield
    _reset_export_router()


def _make_service(full_bytes=b"ZIPDATA", chat_history=None):
    svc = MagicMock()
    svc.export_full = AsyncMock(return_value=full_bytes)
    svc.export_chat_history = AsyncMock(return_value=chat_history or [{"role": "user", "content": "Hi"}])
    return svc


def _make_knowledge_dir(tmp_path: Path) -> Path:
    kdir = tmp_path / "knowledge"
    kdir.mkdir()
    (kdir / "notes.md").write_text("# Notes")
    return kdir


def _create_app(svc=None, knowledge_dir=None):
    app = FastAPI()
    app.include_router(router)
    if svc is not None:
        init_export_router(svc, knowledge_dir=knowledge_dir)
    return app


class TestPostExportFull:
    def test_returns_zip_bytes(self, tmp_path):
        svc = _make_service(full_bytes=b"PK\x03\x04fake_zip")
        client = TestClient(_create_app(svc))
        resp = client.post("/export/full")
        assert resp.status_code == 200
        assert resp.content == b"PK\x03\x04fake_zip"

    def test_content_type_is_zip(self, tmp_path):
        svc = _make_service()
        client = TestClient(_create_app(svc))
        resp = client.post("/export/full")
        assert resp.headers["content-type"] == "application/zip"

    def test_content_disposition_attachment(self, tmp_path):
        svc = _make_service()
        client = TestClient(_create_app(svc))
        resp = client.post("/export/full")
        assert "attachment" in resp.headers.get("content-disposition", "")
        assert ".zip" in resp.headers.get("content-disposition", "")

    def test_503_when_not_initialized(self):
        client = TestClient(_create_app(svc=None))
        resp = client.post("/export/full")
        assert resp.status_code == 503


class TestPostExportChat:
    def test_returns_json_list(self, tmp_path):
        history = [{"role": "user", "content": "Hello"}]
        svc = _make_service(chat_history=history)
        client = TestClient(_create_app(svc))
        resp = client.post("/export/chat")
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)

    def test_content_type_is_json(self):
        svc = _make_service()
        client = TestClient(_create_app(svc))
        resp = client.post("/export/chat")
        assert "application/json" in resp.headers.get("content-type", "")

    def test_503_when_not_initialized(self):
        client = TestClient(_create_app(svc=None))
        resp = client.post("/export/chat")
        assert resp.status_code == 503


class TestPostExportFile:
    def test_returns_file_content(self, tmp_path):
        kdir = _make_knowledge_dir(tmp_path)
        svc = _make_service()
        client = TestClient(_create_app(svc, knowledge_dir=kdir))
        resp = client.post("/export/file", json={"path": "notes.md"})
        assert resp.status_code == 200
        assert b"Notes" in resp.content

    def test_404_for_missing_file(self, tmp_path):
        kdir = _make_knowledge_dir(tmp_path)
        svc = _make_service()
        client = TestClient(_create_app(svc, knowledge_dir=kdir))
        resp = client.post("/export/file", json={"path": "nonexistent.md"})
        assert resp.status_code == 404

    def test_blocks_path_traversal(self, tmp_path):
        kdir = _make_knowledge_dir(tmp_path)
        svc = _make_service()
        client = TestClient(_create_app(svc, knowledge_dir=kdir))
        resp = client.post("/export/file", json={"path": "../../etc/passwd"})
        assert resp.status_code == 400

    def test_503_when_not_initialized(self):
        client = TestClient(_create_app(svc=None))
        resp = client.post("/export/file", json={"path": "notes.md"})
        assert resp.status_code == 503
