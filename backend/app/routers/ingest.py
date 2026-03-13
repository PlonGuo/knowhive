"""Ingest API endpoints — POST /ingest/files, GET /ingest/status, POST /ingest/resync."""
import asyncio
import logging
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, field_validator

from app.database import get_db
from app.services.ingest_service import IngestService

logger = logging.getLogger(__name__)

router = APIRouter()

# Module-level state, set by init_ingest_router()
_service: Optional[IngestService] = None
_knowledge_dir: Optional[str] = None


def init_ingest_router(chroma_path: str = "./chroma_data", knowledge_dir: str = "./knowledge") -> None:
    """Initialize ingest router with Chroma path and knowledge directory."""
    global _service, _knowledge_dir
    _service = IngestService(chroma_path=chroma_path)
    _knowledge_dir = knowledge_dir


def _get_service() -> IngestService:
    if _service is None:
        raise RuntimeError("Ingest router not initialized. Call init_ingest_router() first.")
    return _service


# ── Request/Response models ───────────────────────────────────────


class IngestFilesRequest(BaseModel):
    file_paths: list[str]

    @field_validator("file_paths")
    @classmethod
    def paths_not_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("file_paths must not be empty")
        return v


class IngestResponse(BaseModel):
    task_id: str
    status: str
    total_files: int


class IngestStatusResponse(BaseModel):
    task_id: str
    status: str
    total_files: int
    processed_files: int
    errors: Optional[str] = None


# ── Task execution ────────────────────────────────────────────────


async def _run_ingest_task(task_id: str, file_paths: list[Path]) -> None:
    """Run ingestion for a list of files, updating the ingest_tasks record."""
    service = _get_service()

    try:
        async with get_db() as db:
            await db.execute(
                "UPDATE ingest_tasks SET status = 'running' WHERE id = ?",
                (task_id,),
            )
            await db.commit()

        processed = 0
        errors = []

        for fp in file_paths:
            result = await service.ingest_file(fp, fp.parent)
            processed += 1
            if result["status"] == "error":
                errors.append(f"{fp}: {result.get('error', 'unknown')}")

        async with get_db() as db:
            await db.execute(
                """UPDATE ingest_tasks
                   SET status = ?, processed_files = ?, errors = ?,
                       completed_at = datetime('now')
                   WHERE id = ?""",
                (
                    "failed" if errors else "completed",
                    processed,
                    "\n".join(errors) if errors else None,
                    task_id,
                ),
            )
            await db.commit()

        logger.info("Ingest task %s completed: %d/%d files", task_id, processed, len(file_paths))

    except Exception as e:
        logger.error("Ingest task %s failed: %s", task_id, e)
        try:
            async with get_db() as db:
                await db.execute(
                    """UPDATE ingest_tasks
                       SET status = 'failed', errors = ?, completed_at = datetime('now')
                       WHERE id = ?""",
                    (str(e), task_id),
                )
                await db.commit()
        except Exception:
            pass


# ── Endpoints ─────────────────────────────────────────────────────


@router.post("/ingest/files")
async def ingest_files(request: IngestFilesRequest, background_tasks: BackgroundTasks) -> IngestResponse:
    """Accept file paths for ingestion, return a task ID for tracking."""
    file_paths = [Path(p) for p in request.file_paths]
    task_id = str(uuid.uuid4())

    # Create task record in DB
    async with get_db() as db:
        await db.execute(
            "INSERT INTO ingest_tasks (id, status, total_files) VALUES (?, 'pending', ?)",
            (task_id, len(file_paths)),
        )
        await db.commit()

    # Run synchronously for now (BackgroundTasks runs after response in test client)
    await _run_ingest_task(task_id, file_paths)

    return IngestResponse(task_id=task_id, status="accepted", total_files=len(file_paths))


@router.get("/ingest/status/{task_id}")
async def ingest_status(task_id: str) -> IngestStatusResponse:
    """Get the status of an ingest task."""
    async with get_db() as db:
        cursor = await db.execute("SELECT * FROM ingest_tasks WHERE id = ?", (task_id,))
        row = await cursor.fetchone()

    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")

    return IngestStatusResponse(
        task_id=row["id"],
        status=row["status"],
        total_files=row["total_files"],
        processed_files=row["processed_files"],
        errors=row["errors"],
    )


@router.post("/ingest/resync")
async def ingest_resync(background_tasks: BackgroundTasks) -> IngestResponse:
    """Re-ingest all Markdown files in the knowledge directory."""
    service = _get_service()
    knowledge_path = Path(_knowledge_dir)

    if not knowledge_path.exists():
        knowledge_path.mkdir(parents=True, exist_ok=True)

    files = service.find_markdown_files(knowledge_path)
    task_id = str(uuid.uuid4())

    # Create task record
    async with get_db() as db:
        await db.execute(
            "INSERT INTO ingest_tasks (id, status, total_files) VALUES (?, 'pending', ?)",
            (task_id, len(files)),
        )
        await db.commit()

    # Run ingestion
    await _run_ingest_task(task_id, files)

    return IngestResponse(task_id=task_id, status="accepted", total_files=len(files))
