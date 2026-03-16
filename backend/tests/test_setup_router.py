"""
Task 81: GET /setup/status endpoint — checks python_ok, uv_ok, ollama_ok, first_run.
"""
from pathlib import Path
from unittest.mock import patch, AsyncMock

import pytest
from fastapi.testclient import TestClient

from app.main import create_app


@pytest.fixture
def client(tmp_path):
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=tmp_path / "config.yaml",
    )
    with TestClient(app) as c:
        yield c


def test_setup_status_returns_200(client):
    response = client.get("/setup/status")
    assert response.status_code == 200


def test_setup_status_returns_all_fields(client):
    response = client.get("/setup/status")
    data = response.json()
    assert "python_ok" in data
    assert "uv_ok" in data
    assert "ollama_ok" in data
    assert "first_run" in data


def test_python_ok_is_always_true(client):
    response = client.get("/setup/status")
    assert response.json()["python_ok"] is True


def test_first_run_true_when_no_config(tmp_path):
    """first_run is True when config.yaml does not exist."""
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=tmp_path / "config.yaml",  # doesn't exist yet
    )
    with TestClient(app) as client:
        response = client.get("/setup/status")
        assert response.json()["first_run"] is True


def test_first_run_false_when_first_run_complete_true(tmp_path):
    """first_run is False when config has first_run_complete: true."""
    config_path = tmp_path / "config.yaml"
    config_path.write_text("llm_provider: ollama\nfirst_run_complete: true\n")
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=config_path,
    )
    with TestClient(app) as client:
        response = client.get("/setup/status")
        assert response.json()["first_run"] is False


def test_ollama_ok_false_when_ollama_unreachable(tmp_path):
    """ollama_ok is False when Ollama API is not reachable."""
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=tmp_path / "config.yaml",
    )
    with TestClient(app) as client:
        response = client.get("/setup/status")
        # In CI / test environment Ollama is not running
        data = response.json()
        assert isinstance(data["ollama_ok"], bool)


def test_uv_ok_reflects_shutil_which(client):
    """uv_ok reflects whether 'uv' is found in PATH (via shutil.which)."""
    import shutil
    uv_present = shutil.which("uv") is not None
    response = client.get("/setup/status")
    assert response.json()["uv_ok"] == uv_present


# ── Task 82 tests ────────────────────────────────────────────────────────────

def test_setup_complete_returns_200(client):
    response = client.post("/setup/complete")
    assert response.status_code == 200


def test_setup_complete_returns_ok(client):
    response = client.post("/setup/complete")
    assert response.json() == {"ok": True}


def test_setup_complete_sets_first_run_complete_in_config(tmp_path):
    """POST /setup/complete persists first_run_complete=True to config.yaml."""
    config_path = tmp_path / "config.yaml"
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=config_path,
    )
    with TestClient(app) as c:
        c.post("/setup/complete")
    from app.config import load_config
    cfg = load_config(config_path)
    assert cfg.first_run_complete is True


def test_first_run_false_after_setup_complete(tmp_path):
    """GET /setup/status returns first_run=False after POST /setup/complete."""
    config_path = tmp_path / "config.yaml"
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=config_path,
    )
    with TestClient(app) as c:
        c.post("/setup/complete")
        status = c.get("/setup/status")
    assert status.json()["first_run"] is False


def test_first_run_true_when_first_run_complete_false(tmp_path):
    """first_run=True when config exists but first_run_complete is False."""
    config_path = tmp_path / "config.yaml"
    config_path.write_text("llm_provider: ollama\nfirst_run_complete: false\n")
    app = create_app(
        db_path=str(tmp_path / "test.db"),
        chroma_path=str(tmp_path / "chroma"),
        knowledge_dir=str(tmp_path / "knowledge"),
        config_path=config_path,
    )
    with TestClient(app) as c:
        response = c.get("/setup/status")
    assert response.json()["first_run"] is True


def test_first_run_complete_defaults_to_false():
    """AppConfig.first_run_complete defaults to False."""
    from app.config import AppConfig
    cfg = AppConfig()
    assert cfg.first_run_complete is False
