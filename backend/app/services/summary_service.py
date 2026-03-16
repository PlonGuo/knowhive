"""SummaryService — LLM summarization with DB caching."""
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from app.database import get_db

if TYPE_CHECKING:
    from app.config import AppConfig
    from app.services.rag_service import RAGService

SUMMARIZE_SYSTEM_PROMPT = (
    "You are a concise technical summarizer. "
    "Summarize the provided document content in 2-4 sentences, "
    "capturing the main topics and key points."
)


class SummaryService:
    """Generates and caches LLM summaries of knowledge documents."""

    async def get_cached_summary(self, file_path: str) -> Optional[str]:
        """Return cached summary for a file, or None if not cached."""
        async with get_db() as conn:
            cursor = await conn.execute(
                "SELECT summary FROM summaries WHERE file_path = ?", (file_path,)
            )
            row = await cursor.fetchone()
        return row[0] if row else None

    async def store_summary(self, file_path: str, summary: str) -> None:
        """Insert or replace a summary in the cache."""
        async with get_db() as conn:
            await conn.execute(
                """INSERT INTO summaries (file_path, summary, updated_at)
                   VALUES (?, ?, datetime('now'))
                   ON CONFLICT(file_path) DO UPDATE SET
                       summary=excluded.summary,
                       updated_at=datetime('now')""",
                (file_path, summary),
            )
            await conn.commit()

    async def generate_summary(
        self,
        content: str,
        file_path: str,
        rag_service: "RAGService",
        config: "AppConfig",
    ) -> str:
        """Generate a summary using the LLM."""
        messages = [
            {"role": "system", "content": SUMMARIZE_SYSTEM_PROMPT},
            {"role": "user", "content": f"Document: {file_path}\n\n{content}"},
        ]
        return await rag_service.call_llm(messages, config)

    async def get_or_generate(
        self,
        file_path: str,
        knowledge_dir: Path,
        rag_service: "RAGService",
        config: "AppConfig",
    ) -> Optional[str]:
        """Return cached summary or generate one. Returns None if file missing."""
        # Check cache first
        cached = await self.get_cached_summary(file_path)
        if cached is not None:
            return cached

        # Read file
        target = knowledge_dir / file_path
        if not target.exists():
            return None

        content = target.read_text(encoding="utf-8", errors="replace")
        summary = await self.generate_summary(content, file_path, rag_service, config)
        await self.store_summary(file_path, summary)
        return summary
