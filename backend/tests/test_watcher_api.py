"""Tests for watcher API endpoints — GET /watcher/status, POST /watcher/toggle."""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from fastapi.testclient import TestClient
from app.routers.watcher import router, init_watcher_router, _reset_watcher_router


@pytest.fixture(autouse=True)
def _reset(request):
    """Reset module-level state between tests (skipped for lifespan integration tests)."""
    if request.node.parent and request.node.parent.name == "TestLifespanIntegration":
        yield
        _reset_watcher_router()
        return
    _reset_watcher_router()
    yield
    _reset_watcher_router()


def _make_bridge(running: bool = False, syncing: bool = False):
    bridge = MagicMock()
    bridge.running = running
    bridge.status.return_value = {
        "running": running,
        "knowledge_dir": "/tmp/knowledge",
        "extensions": [".md", ".pdf"],
        "syncing": syncing,
    }
    bridge.start = MagicMock()
    bridge.stop = MagicMock()
    return bridge


def _create_app(bridge=None):
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    if bridge is not None:
        init_watcher_router(bridge)
    return app


class TestGetWatcherStatus:
    def test_returns_status(self):
        bridge = _make_bridge(running=True, syncing=False)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.get("/watcher/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["running"] is True
        assert data["syncing"] is False
        assert data["knowledge_dir"] == "/tmp/knowledge"
        assert ".md" in data["extensions"]

    def test_returns_stopped_status(self):
        bridge = _make_bridge(running=False)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.get("/watcher/status")
        assert resp.status_code == 200
        assert resp.json()["running"] is False

    def test_503_when_not_initialized(self):
        app = _create_app(bridge=None)
        client = TestClient(app)
        resp = client.get("/watcher/status")
        assert resp.status_code == 503
        assert "not available" in resp.json()["detail"].lower()


class TestPostWatcherToggle:
    def test_start_watcher(self):
        bridge = _make_bridge(running=False)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.post("/watcher/toggle", json={"enabled": True})
        assert resp.status_code == 200
        bridge.start.assert_called_once()
        assert resp.json()["running"] is False  # status() returns pre-toggle state from mock

    def test_stop_watcher(self):
        bridge = _make_bridge(running=True)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.post("/watcher/toggle", json={"enabled": False})
        assert resp.status_code == 200
        bridge.stop.assert_called_once()

    def test_start_when_already_running(self):
        bridge = _make_bridge(running=True)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.post("/watcher/toggle", json={"enabled": True})
        assert resp.status_code == 200
        # start() is idempotent in FileWatcher, so it's still called
        bridge.start.assert_called_once()

    def test_stop_when_already_stopped(self):
        bridge = _make_bridge(running=False)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.post("/watcher/toggle", json={"enabled": False})
        assert resp.status_code == 200
        bridge.stop.assert_called_once()

    def test_503_when_not_initialized(self):
        app = _create_app(bridge=None)
        client = TestClient(app)
        resp = client.post("/watcher/toggle", json={"enabled": True})
        assert resp.status_code == 503

    def test_toggle_returns_status(self):
        bridge = _make_bridge(running=False)
        app = _create_app(bridge)
        client = TestClient(app)
        resp = client.post("/watcher/toggle", json={"enabled": True})
        data = resp.json()
        assert "running" in data
        assert "knowledge_dir" in data


class TestLifespanIntegration:
    def test_watcher_bridge_created_in_lifespan(self):
        """Verify main.py creates and starts WatcherBridge in lifespan."""
        import tempfile, os
        from app.main import create_app

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            chroma_path = os.path.join(tmpdir, "chroma")
            knowledge_dir = os.path.join(tmpdir, "knowledge")
            os.makedirs(knowledge_dir)

            app = create_app(
                db_path=db_path,
                chroma_path=chroma_path,
                knowledge_dir=knowledge_dir,
            )
            with TestClient(app) as client:
                # Watcher status should be available after lifespan startup
                resp = client.get("/watcher/status")
                assert resp.status_code == 200
                data = resp.json()
                assert data["running"] is True
                assert data["knowledge_dir"] == knowledge_dir

    def test_watcher_toggle_off_and_on(self):
        """Test toggling watcher via API in integrated setup."""
        import tempfile, os
        from app.main import create_app

        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            chroma_path = os.path.join(tmpdir, "chroma")
            knowledge_dir = os.path.join(tmpdir, "knowledge")
            os.makedirs(knowledge_dir)

            app = create_app(
                db_path=db_path,
                chroma_path=chroma_path,
                knowledge_dir=knowledge_dir,
            )
            with TestClient(app) as client:
                # Stop
                resp = client.post("/watcher/toggle", json={"enabled": False})
                assert resp.status_code == 200

                resp = client.get("/watcher/status")
                assert resp.json()["running"] is False

                # Start again
                resp = client.post("/watcher/toggle", json={"enabled": True})
                assert resp.status_code == 200

                resp = client.get("/watcher/status")
                assert resp.json()["running"] is True
