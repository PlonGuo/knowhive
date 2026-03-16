"""Export API endpoints — POST /export/full, /export/chat, /export/file."""
import logging
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

if TYPE_CHECKING:
    from app.services.export_service import ExportService

logger = logging.getLogger(__name__)

router = APIRouter()

_export_service: Optional["ExportService"] = None
_knowledge_dir: Optional[Path] = None


def init_export_router(
    export_service: "ExportService",
    knowledge_dir: Optional[Path] = None,
) -> None:
    global _export_service, _knowledge_dir
    _export_service = export_service
    _knowledge_dir = knowledge_dir


def _reset_export_router() -> None:
    global _export_service, _knowledge_dir
    _export_service = None
    _knowledge_dir = None


def _get_service() -> "ExportService":
    if _export_service is None:
        raise HTTPException(status_code=503, detail="Export service not available")
    return _export_service


class ExportFileRequest(BaseModel):
    path: str


@router.post("/export/full")
async def export_full() -> Response:
    """Export the full knowledge base as a ZIP archive."""
    svc = _get_service()
    data = await svc.export_full()
    filename = f"knowhive-export-{datetime.now().strftime('%Y%m%d-%H%M%S')}.zip"
    return Response(
        content=data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export/chat")
async def export_chat() -> JSONResponse:
    """Export chat history as JSON."""
    svc = _get_service()
    history = await svc.export_chat_history()
    return JSONResponse(content=history)


@router.post("/export/file")
async def export_file(body: ExportFileRequest) -> Response:
    """Export a single knowledge file (path traversal protected)."""
    _get_service()  # Just validates service is initialized
    if _knowledge_dir is None:
        raise HTTPException(status_code=503, detail="Export service not available")

    # Path traversal protection
    try:
        target = (_knowledge_dir / body.path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid file path")

    if not str(target).startswith(str(_knowledge_dir.resolve())):
        raise HTTPException(status_code=400, detail="Path traversal not allowed")

    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")

    content = target.read_bytes()
    return Response(
        content=content,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{target.name}"'},
    )
