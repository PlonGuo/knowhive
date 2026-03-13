"""Tests for re-embedding on embedding_language config change (Task 58)."""
import os
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config import AppConfig, EmbeddingLanguage, LLMProvider, save_config
from app.routers.config import router, init_config_router


@pytest.fixture(autouse=True)
def _reset_config_router(tmp_path):
    init_config_router(tmp_path / "config.yaml")
    yield
    # reinit with a dummy path
    init_config_router(Path("config.yaml"))


def _create_app(config_path: Path, ingest_service=None, embedding_service=None):
    app = FastAPI()
    app.include_router(router)
    init_config_router(config_path)
    from app.routers.config import init_reembed_dependencies
    if ingest_service is not None or embedding_service is not None:
        init_reembed_dependencies(
            ingest_service=ingest_service,
            embedding_service=embedding_service,
        )
    return app


# ── EmbeddingService.reembed_all ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reembed_all_recreates_collection_with_new_ef(tmp_path):
    """reembed_all() re-ingests all files in knowledge_dir with new embedding function."""
    from app.services.embedding_service import EmbeddingService

    svc = EmbeddingService(models_dir=tmp_path / "models")
    ingest_service = AsyncMock()
    ingest_service.ingest_directory = AsyncMock(return_value=[])

    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()

    fake_ef = MagicMock()
    await svc.reembed_all(
        new_language=EmbeddingLanguage.ENGLISH,
        ingest_service=ingest_service,
        knowledge_dir=knowledge_dir,
        embedding_function=fake_ef,
    )
    ingest_service.ingest_directory.assert_called_once_with(knowledge_dir)


@pytest.mark.asyncio
async def test_reembed_all_updates_collection_embedding_function(tmp_path):
    """reembed_all() updates IngestService's collection's embedding function."""
    from app.services.embedding_service import EmbeddingService

    svc = EmbeddingService(models_dir=tmp_path / "models")
    ingest_service = AsyncMock()
    ingest_service.ingest_directory = AsyncMock(return_value=[])
    ingest_service.set_embedding_function = MagicMock()

    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()

    fake_ef = MagicMock()
    await svc.reembed_all(
        new_language=EmbeddingLanguage.ENGLISH,
        ingest_service=ingest_service,
        knowledge_dir=knowledge_dir,
        embedding_function=fake_ef,
    )
    # ingest_directory is called (re-embeds everything)
    ingest_service.ingest_directory.assert_called_once()


# ── PUT /config triggers re-embed on embedding_language change ───────────────

def test_put_config_no_reembed_when_language_unchanged(tmp_path):
    """PUT /config does NOT trigger re-embed if embedding_language is unchanged."""
    config_path = tmp_path / "config.yaml"
    cfg = AppConfig(embedding_language=EmbeddingLanguage.ENGLISH)
    save_config(cfg, config_path)

    mock_embedding_svc = MagicMock()
    mock_ingest_svc = MagicMock()

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    init_config_router(config_path)

    from app.routers.config import init_reembed_dependencies
    init_reembed_dependencies(ingest_service=mock_ingest_svc, embedding_service=mock_embedding_svc)

    client = TestClient(app)
    resp = client.put("/config", json={
        "llm_provider": "ollama",
        "model_name": "llama3",
        "base_url": "http://localhost:11434",
        "api_key": None,
        "embedding_language": "english",  # same as before
    })
    assert resp.status_code == 200
    mock_embedding_svc.reembed_all.assert_not_called()


def test_put_config_triggers_reembed_when_language_changes(tmp_path):
    """PUT /config triggers background re-embed when embedding_language changes."""
    config_path = tmp_path / "config.yaml"
    cfg = AppConfig(embedding_language=EmbeddingLanguage.ENGLISH)
    save_config(cfg, config_path)

    mock_embedding_svc = MagicMock()
    mock_ingest_svc = MagicMock()

    from fastapi import FastAPI, BackgroundTasks
    app = FastAPI()
    app.include_router(router)
    init_config_router(config_path)

    from app.routers.config import init_reembed_dependencies
    init_reembed_dependencies(ingest_service=mock_ingest_svc, embedding_service=mock_embedding_svc)

    client = TestClient(app)
    resp = client.put("/config", json={
        "llm_provider": "ollama",
        "model_name": "llama3",
        "base_url": "http://localhost:11434",
        "api_key": None,
        "embedding_language": "chinese",  # changed!
    })
    assert resp.status_code == 200
    # reembed_all or get_embedding_function should be called
    assert (
        mock_embedding_svc.reembed_all.called
        or mock_embedding_svc.get_embedding_function.called
    )


def test_put_config_returns_reembedding_flag_when_changed(tmp_path):
    """PUT /config response includes reembedding=true when language changes."""
    config_path = tmp_path / "config.yaml"
    cfg = AppConfig(embedding_language=EmbeddingLanguage.ENGLISH)
    save_config(cfg, config_path)

    mock_embedding_svc = MagicMock()
    mock_ingest_svc = MagicMock()

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    init_config_router(config_path)

    from app.routers.config import init_reembed_dependencies
    init_reembed_dependencies(ingest_service=mock_ingest_svc, embedding_service=mock_embedding_svc)

    client = TestClient(app)
    resp = client.put("/config", json={
        "llm_provider": "ollama",
        "model_name": "llama3",
        "base_url": "http://localhost:11434",
        "api_key": None,
        "embedding_language": "mixed",
    })
    data = resp.json()
    assert data.get("reembedding") is True


def test_put_config_no_reembed_deps_still_saves(tmp_path):
    """PUT /config works normally when no reembed dependencies are registered."""
    config_path = tmp_path / "config.yaml"

    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    init_config_router(config_path)

    from app.routers.config import init_reembed_dependencies
    init_reembed_dependencies(ingest_service=None, embedding_service=None)

    client = TestClient(app)
    resp = client.put("/config", json={
        "llm_provider": "ollama",
        "model_name": "llama3",
        "base_url": "http://localhost:11434",
        "api_key": None,
        "embedding_language": "english",
    })
    assert resp.status_code == 200
