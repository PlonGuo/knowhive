"""Tests for FileWatcher service — watchdog-based file system monitoring with debounce."""
import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.file_watcher import FileWatcher


@pytest.fixture
def tmp_knowledge_dir(tmp_path):
    """Create a temporary knowledge directory."""
    knowledge_dir = tmp_path / "knowledge"
    knowledge_dir.mkdir()
    return knowledge_dir


@pytest.fixture
def watcher(tmp_knowledge_dir):
    """Create a FileWatcher instance with a short debounce for fast tests."""
    callback = AsyncMock()
    fw = FileWatcher(
        knowledge_dir=tmp_knowledge_dir,
        on_change=callback,
        debounce_seconds=0.2,
    )
    return fw


class TestFileWatcherInit:
    def test_init_sets_knowledge_dir(self, watcher, tmp_knowledge_dir):
        assert watcher.knowledge_dir == tmp_knowledge_dir

    def test_init_not_running(self, watcher):
        assert watcher.running is False

    def test_init_default_extensions(self, watcher):
        assert ".md" in watcher.extensions
        assert ".pdf" in watcher.extensions

    def test_init_custom_extensions(self, tmp_knowledge_dir):
        fw = FileWatcher(
            knowledge_dir=tmp_knowledge_dir,
            on_change=AsyncMock(),
            extensions={".txt", ".md"},
        )
        assert fw.extensions == {".txt", ".md"}


class TestExtensionFilter:
    def test_accepts_md_file(self, watcher):
        assert watcher._is_watched_extension(Path("notes.md")) is True

    def test_accepts_pdf_file(self, watcher):
        assert watcher._is_watched_extension(Path("doc.pdf")) is True

    def test_rejects_txt_file(self, watcher):
        assert watcher._is_watched_extension(Path("readme.txt")) is False

    def test_rejects_py_file(self, watcher):
        assert watcher._is_watched_extension(Path("script.py")) is False

    def test_case_insensitive(self, watcher):
        assert watcher._is_watched_extension(Path("doc.MD")) is True
        assert watcher._is_watched_extension(Path("doc.Pdf")) is True


class TestStartStop:
    def test_start_sets_running(self, watcher):
        watcher.start()
        try:
            assert watcher.running is True
        finally:
            watcher.stop()

    def test_stop_sets_not_running(self, watcher):
        watcher.start()
        watcher.stop()
        assert watcher.running is False

    def test_double_start_is_safe(self, watcher):
        watcher.start()
        watcher.start()  # should not raise
        try:
            assert watcher.running is True
        finally:
            watcher.stop()

    def test_stop_without_start_is_safe(self, watcher):
        watcher.stop()  # should not raise
        assert watcher.running is False


class TestDebounce:
    @pytest.mark.asyncio
    async def test_debounce_coalesces_rapid_changes(self, watcher, tmp_knowledge_dir):
        """Multiple rapid changes should result in a single callback invocation."""
        watcher.start()
        try:
            # Simulate rapid file changes
            f = tmp_knowledge_dir / "test.md"
            f.write_text("v1")
            await asyncio.sleep(0.05)
            f.write_text("v2")
            await asyncio.sleep(0.05)
            f.write_text("v3")

            # Wait for debounce to fire
            await asyncio.sleep(0.5)

            # Callback should have been called (at least once, but coalesced)
            assert watcher._on_change.call_count >= 1
            # Should be fewer calls than changes
            assert watcher._on_change.call_count <= 2
        finally:
            watcher.stop()

    @pytest.mark.asyncio
    async def test_ignores_non_watched_extensions(self, watcher, tmp_knowledge_dir):
        """Changes to non-watched files should not trigger callback."""
        watcher.start()
        try:
            f = tmp_knowledge_dir / "notes.txt"
            f.write_text("should be ignored")
            await asyncio.sleep(0.5)

            watcher._on_change.assert_not_called()
        finally:
            watcher.stop()

    @pytest.mark.asyncio
    async def test_detects_new_file(self, watcher, tmp_knowledge_dir):
        """Creating a new watched file should trigger callback."""
        watcher.start()
        try:
            f = tmp_knowledge_dir / "new.md"
            f.write_text("hello")
            await asyncio.sleep(0.5)

            assert watcher._on_change.call_count >= 1
        finally:
            watcher.stop()

    @pytest.mark.asyncio
    async def test_detects_file_deletion(self, watcher, tmp_knowledge_dir):
        """Deleting a watched file should trigger callback."""
        f = tmp_knowledge_dir / "to_delete.md"
        f.write_text("delete me")
        await asyncio.sleep(0.1)

        watcher.start()
        try:
            # Reset call count after start (start may trigger from pre-existing)
            watcher._on_change.reset_mock()
            await asyncio.sleep(0.3)

            f.unlink()
            await asyncio.sleep(0.5)

            assert watcher._on_change.call_count >= 1
        finally:
            watcher.stop()


class TestStatus:
    def test_status_when_stopped(self, watcher):
        status = watcher.status()
        assert status["running"] is False
        assert "knowledge_dir" in status
        assert "extensions" in status

    def test_status_when_running(self, watcher):
        watcher.start()
        try:
            status = watcher.status()
            assert status["running"] is True
        finally:
            watcher.stop()
