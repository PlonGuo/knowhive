"""Startup sync service — scan knowledge/ dir, diff with DB, re-embed changes."""
import logging
from pathlib import Path
from typing import Any

from app.database import get_db
from app.services.ingest_service import IngestService

logger = logging.getLogger(__name__)


class SyncService:
    """Compares filesystem state with DB and syncs: new→embed, modified→re-embed, deleted→remove."""

    def __init__(self, ingest_service: IngestService, knowledge_dir: Path):
        self._ingest = ingest_service
        self._knowledge_dir = knowledge_dir

    async def sync(self) -> dict[str, Any]:
        """Run a full sync pass. Returns counts of new, modified, deleted files and any errors."""
        errors: list[str] = []
        new_count = 0
        modified_count = 0
        deleted_count = 0

        # 1. Discover current files on disk
        disk_files = self._ingest.find_ingestable_files(self._knowledge_dir)
        disk_paths = {str(f) for f in disk_files}

        # 2. Get all known files from DB
        async with get_db() as db:
            cursor = await db.execute("SELECT file_path, file_hash FROM documents")
            db_rows = await cursor.fetchall()

        db_map = {row["file_path"]: row["file_hash"] for row in db_rows}
        db_paths = set(db_map.keys())

        # 3. Categorize: new, potentially modified, deleted
        new_paths = disk_paths - db_paths
        existing_paths = disk_paths & db_paths
        deleted_paths = db_paths - disk_paths

        # 4. Process new files
        for file_path_str in sorted(new_paths):
            file_path = Path(file_path_str)
            result = await self._ingest.ingest_file(file_path, self._knowledge_dir)
            if result["status"] == "error":
                errors.append(f"New file error: {file_path_str}: {result.get('error', 'unknown')}")
            else:
                new_count += 1

        # 5. Check existing files for modifications (hash comparison)
        for file_path_str in sorted(existing_paths):
            file_path = Path(file_path_str)
            try:
                current_hash = self._ingest.compute_file_hash(file_path)
            except Exception as e:
                errors.append(f"Hash error: {file_path_str}: {e}")
                continue

            if current_hash != db_map[file_path_str]:
                result = await self._ingest.ingest_file(file_path, self._knowledge_dir)
                if result["status"] == "error":
                    errors.append(f"Re-embed error: {file_path_str}: {result.get('error', 'unknown')}")
                else:
                    modified_count += 1

        # 6. Remove deleted files from DB and Chroma
        for file_path_str in sorted(deleted_paths):
            try:
                self._ingest.delete_chunks_for_file(file_path_str)
                async with get_db() as db:
                    await db.execute("DELETE FROM documents WHERE file_path = ?", (file_path_str,))
                    await db.commit()
                deleted_count += 1
            except Exception as e:
                errors.append(f"Delete error: {file_path_str}: {e}")

        logger.info(
            "Sync complete: %d new, %d modified, %d deleted, %d errors",
            new_count, modified_count, deleted_count, len(errors),
        )

        return {
            "new": new_count,
            "modified": modified_count,
            "deleted": deleted_count,
            "errors": errors,
        }
