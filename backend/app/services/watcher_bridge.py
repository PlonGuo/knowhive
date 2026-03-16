"""WatcherBridge — async bridge between FileWatcher and SyncService."""
import asyncio
import logging
from pathlib import Path
from typing import Any, Optional, Set

from app.services.file_watcher import FileWatcher
from app.services.sync_service import SyncService

logger = logging.getLogger(__name__)


class WatcherBridge:
    """Connects FileWatcher to SyncService: file changes trigger a full sync pass."""

    def __init__(
        self,
        sync_service: SyncService,
        knowledge_dir: Path,
        debounce_seconds: float = 1.0,
        extensions: Optional[Set[str]] = None,
    ):
        self._sync_service = sync_service
        self._debounce_seconds = debounce_seconds
        self._syncing = False
        self._watcher = FileWatcher(
            knowledge_dir=knowledge_dir,
            on_change=self._on_change,
            debounce_seconds=debounce_seconds,
            extensions=extensions,
        )

    @property
    def watcher(self) -> FileWatcher:
        return self._watcher

    @property
    def running(self) -> bool:
        return self._watcher.running

    @property
    def debounce_seconds(self) -> float:
        return self._debounce_seconds

    async def _on_change(self) -> None:
        """Called by FileWatcher when watched files change. Triggers a sync pass."""
        if self._syncing:
            logger.debug("Sync already in progress, skipping")
            return

        self._syncing = True
        try:
            logger.info("File change detected — running sync")
            stats = await self._sync_service.sync()
            logger.info(
                "Watcher sync complete: %d new, %d modified, %d deleted",
                stats["new"],
                stats["modified"],
                stats["deleted"],
            )
        except Exception:
            logger.exception("Watcher sync failed")
        finally:
            self._syncing = False

    def start(self) -> None:
        self._watcher.start()

    def stop(self) -> None:
        self._watcher.stop()

    def status(self) -> dict[str, Any]:
        result = self._watcher.status()
        result["syncing"] = self._syncing
        return result
