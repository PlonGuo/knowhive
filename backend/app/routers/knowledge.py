"""Knowledge API endpoints — GET /knowledge/tree, GET /knowledge/file, PUT /knowledge/file, DELETE /knowledge/file."""
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

if TYPE_CHECKING:
    from app.services.ingest_service import IngestService

logger = logging.getLogger(__name__)

router = APIRouter()

_knowledge_dir: Optional[str] = None
_ingest_service: Optional["IngestService"] = None


def init_knowledge_router(
    knowledge_dir: str = "./knowledge",
    ingest_service: Optional["IngestService"] = None,
) -> None:
    """Initialize knowledge router with the knowledge directory path and optional ingest service."""
    global _knowledge_dir, _ingest_service
    _knowledge_dir = knowledge_dir
    _ingest_service = ingest_service


def _get_knowledge_path() -> Path:
    if _knowledge_dir is None:
        raise RuntimeError("Knowledge router not initialized. Call init_knowledge_router() first.")
    return Path(_knowledge_dir)


def _build_tree(directory: Path, base: Path) -> dict:
    """Recursively build a file tree dict for a directory."""
    children = []
    try:
        entries = sorted(directory.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        entries = []

    for entry in entries:
        rel = entry.relative_to(base)
        if entry.is_dir():
            children.append(
                {
                    "name": entry.name,
                    "path": str(rel),
                    "type": "directory",
                    "children": _build_tree(entry, base)["children"],
                }
            )
        else:
            children.append(
                {
                    "name": entry.name,
                    "path": str(rel),
                    "type": "file",
                }
            )

    return {"children": children}


@router.get("/knowledge/tree")
def knowledge_tree() -> dict:
    """Return a file tree JSON of the knowledge directory."""
    root = _get_knowledge_path()
    if not root.exists():
        root.mkdir(parents=True, exist_ok=True)
    tree = _build_tree(root, root)
    tree["name"] = root.name
    tree["path"] = ""
    tree["type"] = "directory"
    return tree


def _resolve_safe_path(path: str) -> Path:
    """Resolve a relative path within the knowledge dir, blocking traversal and absolute paths."""
    if path.startswith("/"):
        raise HTTPException(status_code=400, detail="Absolute paths are not allowed")

    root = _get_knowledge_path()
    resolved = (root / path).resolve()

    try:
        resolved.relative_to(root.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path traversal is not allowed")

    return resolved


@router.get("/knowledge/file")
def knowledge_file(path: str = Query(..., description="Relative path within knowledge dir")) -> dict:
    """Return the content of a file in the knowledge directory (read-only)."""
    resolved = _resolve_safe_path(path)

    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    try:
        content = resolved.read_text(encoding="utf-8")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading file: {e}")

    return {
        "name": resolved.name,
        "path": path,
        "content": content,
    }


class SaveContentRequest(BaseModel):
    path: str
    content: str


class RenameRequest(BaseModel):
    old_path: str
    new_path: str


@router.put("/knowledge/file/content")
async def save_knowledge_file_content(req: SaveContentRequest) -> dict:
    """Save content to a file in the knowledge directory and re-ingest it."""
    resolved = _resolve_safe_path(req.path)

    if resolved.exists() and resolved.is_dir():
        raise HTTPException(status_code=400, detail="Cannot save content to directories")

    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    # Write content to disk
    resolved.write_text(req.content, encoding="utf-8")

    # Re-ingest the file
    if _ingest_service is not None:
        root = _get_knowledge_path()
        await _ingest_service.ingest_file(resolved, root)

    logger.info("Saved content to knowledge file: %s", req.path)

    return {"path": req.path, "status": "saved"}


@router.put("/knowledge/file")
async def rename_knowledge_file(req: RenameRequest) -> dict:
    """Rename/move a file within the knowledge directory, updating DB and Chroma."""
    old_resolved = _resolve_safe_path(req.old_path)
    new_resolved = _resolve_safe_path(req.new_path)

    if old_resolved.exists() and old_resolved.is_dir():
        raise HTTPException(status_code=400, detail="Cannot rename directories")

    if not old_resolved.exists() or not old_resolved.is_file():
        raise HTTPException(status_code=404, detail="Source file not found")

    if new_resolved.exists():
        raise HTTPException(status_code=409, detail="Target file already exists")

    old_path_str = str(old_resolved)
    new_path_str = str(new_resolved)

    # Create parent directories if needed
    new_resolved.parent.mkdir(parents=True, exist_ok=True)

    # Rename on disk
    old_resolved.rename(new_resolved)

    # Update Chroma metadata
    if _ingest_service is not None:
        _ingest_service.rename_chunks_file_path(old_path_str, new_path_str)

    # Update DB record
    try:
        from app.database import get_db

        async with get_db() as db:
            await db.execute(
                """UPDATE documents SET file_path = ?, file_name = ?,
                   updated_at = datetime('now') WHERE file_path = ?""",
                (new_path_str, new_resolved.name, old_path_str),
            )
            await db.commit()
    except RuntimeError:
        # DB not initialized (e.g., in minimal test setups) — skip
        pass

    logger.info("Renamed knowledge file: %s → %s", req.old_path, req.new_path)

    return {"old_path": req.old_path, "new_path": req.new_path, "status": "renamed"}


@router.delete("/knowledge/file")
async def delete_knowledge_file(
    path: str = Query(..., description="Relative path within knowledge dir"),
) -> dict:
    """Delete a file from the knowledge directory, DB, and Chroma."""
    resolved = _resolve_safe_path(path)

    if resolved.exists() and resolved.is_dir():
        raise HTTPException(status_code=400, detail="Cannot delete directories")

    if not resolved.exists() or not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")

    file_path_str = str(resolved)

    # Clean up Chroma chunks
    if _ingest_service is not None:
        _ingest_service.delete_chunks_for_file(file_path_str)

    # Clean up DB record
    try:
        from app.database import get_db

        async with get_db() as db:
            await db.execute("DELETE FROM documents WHERE file_path = ?", (file_path_str,))
            await db.commit()
    except RuntimeError:
        # DB not initialized (e.g., in minimal test setups) — skip
        pass

    # Delete from disk
    resolved.unlink()
    logger.info("Deleted knowledge file: %s", path)

    return {"path": path, "status": "deleted"}
