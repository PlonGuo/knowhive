"""Tests for EmbeddingService wired into IngestService and lifespan."""
import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import chromadb
import pytest
from chromadb import Documents, Embeddings
from chromadb.api.types import EmbeddingFunction
from fastapi.testclient import TestClient


class FakeEmbeddingFunction(EmbeddingFunction):
    """Minimal valid chromadb EmbeddingFunction for tests."""
    def __call__(self, input: Documents) -> Embeddings:
        return [[0.1] * 384] * len(input)


# ── IngestService embedding_function param ────────────────────────────────────

def test_ingest_service_accepts_embedding_function(tmp_path):
    """IngestService can be created with a custom embedding_function."""
    from app.services.ingest_service import IngestService
    fake_ef = FakeEmbeddingFunction()
    # Should not raise
    svc = IngestService(chroma_path=str(tmp_path), embedding_function=fake_ef)
    assert svc is not None


def test_ingest_service_passes_embedding_function_to_chroma(tmp_path):
    """IngestService passes embedding_function to get_or_create_collection."""
    from app.services.ingest_service import IngestService

    fake_ef = FakeEmbeddingFunction()
    mock_client = MagicMock()
    mock_client.get_or_create_collection.return_value = MagicMock()
    with patch("app.services.ingest_service.chromadb.PersistentClient", return_value=mock_client):
        IngestService(chroma_path=str(tmp_path), embedding_function=fake_ef)
        mock_client.get_or_create_collection.assert_called_once()
        call_kwargs = mock_client.get_or_create_collection.call_args[1]
        assert call_kwargs.get("embedding_function") is fake_ef


def test_ingest_service_default_no_embedding_function(tmp_path):
    """IngestService with no embedding_function doesn't break (uses Chroma default)."""
    from app.services.ingest_service import IngestService
    svc = IngestService(chroma_path=str(tmp_path))
    assert svc.collection is not None


def test_ingest_service_none_embedding_function_not_passed(tmp_path):
    """IngestService skips passing embedding_function when None."""
    from app.services.ingest_service import IngestService

    mock_client = MagicMock()
    mock_client.get_or_create_collection.return_value = MagicMock()
    with patch("app.services.ingest_service.chromadb.PersistentClient", return_value=mock_client):
        IngestService(chroma_path=str(tmp_path), embedding_function=None)
        call_kwargs = mock_client.get_or_create_collection.call_args[1]
        assert "embedding_function" not in call_kwargs


# ── main.py lifespan creates EmbeddingService + mounts router ─────────────────

def test_lifespan_creates_embedding_service():
    """create_app lifespan initializes EmbeddingService."""
    from app.main import create_app

    with tempfile.TemporaryDirectory() as tmpdir:
        app = create_app(
            db_path=os.path.join(tmpdir, "test.db"),
            chroma_path=os.path.join(tmpdir, "chroma"),
            knowledge_dir=os.path.join(tmpdir, "knowledge"),
        )
        with TestClient(app) as client:
            # Embedding router should be mounted and respond
            resp = client.get("/embedding/models")
            assert resp.status_code == 200


def test_lifespan_embedding_models_returns_list():
    """GET /embedding/models returns a non-empty list after startup."""
    from app.main import create_app

    with tempfile.TemporaryDirectory() as tmpdir:
        app = create_app(
            db_path=os.path.join(tmpdir, "test.db"),
            chroma_path=os.path.join(tmpdir, "chroma"),
            knowledge_dir=os.path.join(tmpdir, "knowledge"),
        )
        with TestClient(app) as client:
            resp = client.get("/embedding/models")
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 3
            langs = {m["language"] for m in data}
            assert langs == {"english", "chinese", "mixed"}


def test_lifespan_embedding_status_endpoint():
    """GET /embedding/status?language=english returns valid response after startup."""
    from app.main import create_app

    with tempfile.TemporaryDirectory() as tmpdir:
        app = create_app(
            db_path=os.path.join(tmpdir, "test.db"),
            chroma_path=os.path.join(tmpdir, "chroma"),
            knowledge_dir=os.path.join(tmpdir, "knowledge"),
        )
        with TestClient(app) as client:
            resp = client.get("/embedding/status?language=english")
            assert resp.status_code == 200
            data = resp.json()
            assert "language" in data


def test_lifespan_ingest_service_uses_embedding_from_config():
    """IngestService is created with embedding_function matching config's embedding_language."""
    from app.main import create_app
    from app.services.embedding_service import EmbeddingService

    captured = {}

    def capture_ef(self, language):
        captured["language"] = language
        return FakeEmbeddingFunction()

    with patch.object(EmbeddingService, "get_embedding_function", capture_ef):
        with tempfile.TemporaryDirectory() as tmpdir:
            app = create_app(
                db_path=os.path.join(tmpdir, "test.db"),
                chroma_path=os.path.join(tmpdir, "chroma"),
                knowledge_dir=os.path.join(tmpdir, "knowledge"),
            )
            with TestClient(app):
                pass  # lifespan runs

    # The default config has embedding_language=english
    assert "language" in captured


# ── Backward compat: existing ingest tests still pass ────────────────────────

@pytest.mark.asyncio
async def test_ingest_file_works_with_custom_embedding(tmp_path):
    """ingest_file still works when embedding_function is provided."""
    from app.database import close_db, init_db
    from app.services.ingest_service import IngestService

    db_path = str(tmp_path / "test.db")
    await init_db(db_path)

    try:
        md = tmp_path / "test.md"
        md.write_text("# Hello\n\nTest content.\n")

        fake_ef = FakeEmbeddingFunction()
        svc = IngestService(chroma_path=str(tmp_path / "chroma"), embedding_function=fake_ef)
        result = await svc.ingest_file(md, tmp_path)
        assert result["status"] == "indexed"
    finally:
        await close_db()
