"""ExportService — ZIP export of knowledge files, chat history, config."""
import json
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from app.database import get_db


class ExportService:
    """Exports knowledge base data as ZIP or JSON."""

    def __init__(self, knowledge_dir: Path, config_path: Path, db_path: str):
        self._knowledge_dir = knowledge_dir
        self._config_path = config_path
        self._db_path = db_path

    async def export_chat_history(self) -> list[dict[str, Any]]:
        """Return all chat messages as a list of dicts."""
        async with get_db() as db:
            cursor = await db.execute(
                "SELECT role, content, created_at FROM chat_messages ORDER BY created_at"
            )
            rows = await cursor.fetchall()
        return [{"role": r["role"], "content": r["content"], "created_at": r["created_at"]} for r in rows]

    async def export_full(self) -> bytes:
        """Build an in-memory ZIP containing knowledge/, config.yaml, and chat_history.json."""
        buf = BytesIO()
        chat_history = await self.export_chat_history()

        with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
            # knowledge/ files
            if self._knowledge_dir.exists():
                for file_path in self._knowledge_dir.rglob("*"):
                    if file_path.is_file():
                        arcname = "knowledge/" + file_path.relative_to(self._knowledge_dir).as_posix()
                        zf.write(file_path, arcname)

            # config.yaml
            if self._config_path.exists():
                zf.write(self._config_path, "config.yaml")

            # chat_history.json
            zf.writestr("chat_history.json", json.dumps(chat_history, ensure_ascii=False, indent=2))

        return buf.getvalue()
