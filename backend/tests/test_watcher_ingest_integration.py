"""Tests for FileWatcher + IngestService integration (async bridge)."""
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.file_watcher import FileWatcher
from app.services.watcher_bridge import WatcherBridge


@pytest.fixture
def tmp_knowledge_dir(tmp_path):
    """Create a temporary knowledge directory."""
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    return knowledge_dir


@pytest.fixture
def mock_sync_service():
    """Create a mock SyncService."""
    svc = MagicMock()
    svc.sync = AsyncMock(return_value={"new": 1, "modified": 0, "deleted": 0, "errors": []})
    return svc


class TestWatcherBridgeInit:
    def test_creates_file_watcher(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        assert bridge.watcher is not None
        assert isinstance(bridge.watcher, FileWatcher)

    def test_watcher_uses_knowledge_dir(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        assert bridge.watcher.knowledge_dir == tmp_knowledge_dir

    def test_custom_debounce(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(
            sync_service=mock_sync_service,
            knowledge_dir=tmp_knowledge_dir,
            debounce_seconds=5.0,
        )
        assert bridge.debounce_seconds == 5.0

    def test_not_running_initially(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        assert bridge.running is False


class TestWatcherBridgeCallback:
    @pytest.mark.asyncio
    async def test_callback_triggers_sync(self, tmp_knowledge_dir, mock_sync_service):
        """When the watcher fires, the bridge should call sync_service.sync()."""
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        # Directly invoke the callback
        await bridge._on_change()
        mock_sync_service.sync.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_callback_logs_sync_result(self, tmp_knowledge_dir, mock_sync_service):
        """Callback should log sync results without raising."""
        mock_sync_service.sync.return_value = {"new": 2, "modified": 1, "deleted": 0, "errors": []}
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        # Should not raise
        await bridge._on_change()
        mock_sync_service.sync.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_callback_handles_sync_error(self, tmp_knowledge_dir, mock_sync_service):
        """Sync errors should be caught and logged, not propagated."""
        mock_sync_service.sync.side_effect = RuntimeError("DB connection failed")
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        # Should not raise
        await bridge._on_change()
        mock_sync_service.sync.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_callback_skips_if_sync_in_progress(self, tmp_knowledge_dir, mock_sync_service):
        """If a sync is already running, the callback should skip (not queue another)."""
        # Make sync take a while
        async def slow_sync():
            await asyncio.sleep(0.3)
            return {"new": 0, "modified": 0, "deleted": 0, "errors": []}

        mock_sync_service.sync = AsyncMock(side_effect=slow_sync)
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)

        # Fire two callbacks concurrently
        await asyncio.gather(bridge._on_change(), bridge._on_change())

        # sync should only have been called once (second was skipped)
        assert mock_sync_service.sync.await_count == 1


class TestWatcherBridgeStartStop:
    def test_start_sets_running(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        bridge.start()
        try:
            assert bridge.running is True
        finally:
            bridge.stop()

    def test_stop_sets_not_running(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        bridge.start()
        bridge.stop()
        assert bridge.running is False

    def test_status_returns_watcher_status(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        status = bridge.status()
        assert "running" in status
        assert "knowledge_dir" in status
        assert "syncing" in status

    def test_status_syncing_false_initially(self, tmp_knowledge_dir, mock_sync_service):
        bridge = WatcherBridge(sync_service=mock_sync_service, knowledge_dir=tmp_knowledge_dir)
        assert bridge.status()["syncing"] is False


class TestWatcherBridgeEndToEnd:
    @pytest.mark.asyncio
    async def test_file_change_triggers_sync(self, tmp_knowledge_dir, mock_sync_service):
        """End-to-end: writing a .md file should eventually trigger sync."""
        bridge = WatcherBridge(
            sync_service=mock_sync_service,
            knowledge_dir=tmp_knowledge_dir,
            debounce_seconds=0.2,
        )
        bridge.start()
        try:
            # Create a file
            (tmp_knowledge_dir / "test.md").write_text("hello")
            # Wait for debounce + async bridge
            await asyncio.sleep(0.8)
            assert mock_sync_service.sync.await_count >= 1
        finally:
            bridge.stop()
