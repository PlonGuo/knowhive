"""FileWatcher service — watchdog-based file system monitoring with debounce and extension filter."""
import asyncio
import logging
import threading
from pathlib import Path
from typing import Any, Awaitable, Callable, Optional, Set

from watchdog.events import FileSystemEvent, FileSystemEventHandler
from watchdog.observers import Observer

logger = logging.getLogger(__name__)

DEFAULT_EXTENSIONS = {".md", ".pdf"}
DEFAULT_DEBOUNCE_SECONDS = 1.0


class _DebouncedHandler(FileSystemEventHandler):
    """Watchdog handler that debounces events and filters by extension."""

    def __init__(
        self,
        on_change: Callable[[], Awaitable[None]],
        extensions: Set[str],
        debounce_seconds: float,
        loop: asyncio.AbstractEventLoop,
    ):
        super().__init__()
        self._on_change = on_change
        self._extensions = extensions
        self._debounce_seconds = debounce_seconds
        self._loop = loop
        self._timer: Optional[threading.Timer] = None
        self._lock = threading.Lock()

    def _is_watched(self, path: str) -> bool:
        return Path(path).suffix.lower() in self._extensions

    def _schedule_callback(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
            self._timer = threading.Timer(self._debounce_seconds, self._fire)
            self._timer.daemon = True
            self._timer.start()

    def _fire(self) -> None:
        logger.debug("Debounce timer fired — scheduling change callback")
        asyncio.run_coroutine_threadsafe(self._on_change(), self._loop)

    def on_any_event(self, event: FileSystemEvent) -> None:
        # Ignore directory events
        if event.is_directory:
            return
        src = getattr(event, "src_path", "")
        if self._is_watched(src):
            self._schedule_callback()
        # Also check dest_path for move events
        dest = getattr(event, "dest_path", None)
        if dest and self._is_watched(dest):
            self._schedule_callback()

    def cancel(self) -> None:
        with self._lock:
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None


class FileWatcher:
    """Watches a knowledge directory for file changes, with debounce and extension filtering."""

    def __init__(
        self,
        knowledge_dir: Path,
        on_change: Callable[[], Awaitable[None]],
        debounce_seconds: float = DEFAULT_DEBOUNCE_SECONDS,
        extensions: Optional[Set[str]] = None,
    ):
        self._knowledge_dir = knowledge_dir
        self._on_change = on_change
        self._debounce_seconds = debounce_seconds
        self._extensions = extensions or DEFAULT_EXTENSIONS
        self._observer: Optional[Observer] = None
        self._handler: Optional[_DebouncedHandler] = None
        self._running = False

    @property
    def knowledge_dir(self) -> Path:
        return self._knowledge_dir

    @property
    def running(self) -> bool:
        return self._running

    @property
    def extensions(self) -> Set[str]:
        return self._extensions

    def _is_watched_extension(self, path: Path) -> bool:
        return path.suffix.lower() in self._extensions

    def start(self) -> None:
        if self._running:
            return

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = asyncio.get_event_loop()

        self._handler = _DebouncedHandler(
            on_change=self._on_change,
            extensions=self._extensions,
            debounce_seconds=self._debounce_seconds,
            loop=loop,
        )
        self._observer = Observer()
        self._observer.schedule(self._handler, str(self._knowledge_dir), recursive=True)
        self._observer.daemon = True
        self._observer.start()
        self._running = True
        logger.info("FileWatcher started on %s", self._knowledge_dir)

    def stop(self) -> None:
        if not self._running:
            return

        if self._handler:
            self._handler.cancel()
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=5)
            self._observer = None
        self._running = False
        logger.info("FileWatcher stopped")

    def status(self) -> dict[str, Any]:
        return {
            "running": self._running,
            "knowledge_dir": str(self._knowledge_dir),
            "extensions": sorted(self._extensions),
        }
