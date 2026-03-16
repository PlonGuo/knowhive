"""Summary API router — GET /summary/file, POST /summary/generate, POST /summary/batch."""
import logging
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

if TYPE_CHECKING:
    from app.config import AppConfig
    from app.services.rag_service import RAGService
    from app.services.summary_service import SummaryService

logger = logging.getLogger(__name__)

router = APIRouter()

_summary_service: Optional["SummaryService"] = None
_rag_service: Optional["RAGService"] = None
_config_path: Optional[Path] = None
_knowledge_dir: Optional[Path] = None


def init_summary_router(
    summary_service: "SummaryService",
    rag_service: Optional["RAGService"] = None,
    config_path: Optional[Path] = None,
    knowledge_dir: Optional[Path] = None,
) -> None:
    global _summary_service, _rag_service, _config_path, _knowledge_dir
    _summary_service = summary_service
    _rag_service = rag_service
    _config_path = config_path
    _knowledge_dir = knowledge_dir


def _reset_summary_router() -> None:
    global _summary_service, _rag_service, _config_path, _knowledge_dir
    _summary_service = None
    _rag_service = None
    _config_path = None
    _knowledge_dir = None


def _get_service() -> "SummaryService":
    if _summary_service is None:
        raise HTTPException(status_code=503, detail="Summary service not available")
    return _summary_service


def _get_rag() -> "RAGService":
    if _rag_service is None:
        raise HTTPException(status_code=503, detail="RAG service not available for summary generation")
    return _rag_service


def _get_config() -> "AppConfig":
    from app.config import load_config
    path = _config_path
    if path is None:
        from app.main import DEFAULT_CONFIG_PATH
        path = DEFAULT_CONFIG_PATH
    return load_config(path)


class GenerateRequest(BaseModel):
    file_path: str


class BatchRequest(BaseModel):
    file_paths: list[str]


@router.get("/summary/file")
async def get_summary(file_path: str) -> dict[str, Any]:
    """Return cached summary for a file."""
    svc = _get_service()
    summary = await svc.get_cached_summary(file_path)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"No cached summary for '{file_path}'")
    return {"file_path": file_path, "summary": summary, "cached": True}


@router.post("/summary/generate")
async def generate_summary(body: GenerateRequest) -> dict[str, Any]:
    """Generate (or return cached) summary for a file."""
    svc = _get_service()
    rag = _get_rag()
    config = _get_config()
    kdir = _knowledge_dir

    summary = await svc.get_or_generate(body.file_path, kdir or Path("."), rag, config)
    if summary is None:
        raise HTTPException(status_code=404, detail=f"File not found: '{body.file_path}'")
    return {"file_path": body.file_path, "summary": summary}


@router.post("/summary/batch")
async def batch_summaries(body: BatchRequest) -> list[dict[str, Any]]:
    """Generate summaries for multiple files, skipping missing ones."""
    svc = _get_service()
    rag = _get_rag()
    config = _get_config()
    kdir = _knowledge_dir or Path(".")

    results = []
    for fp in body.file_paths:
        summary = await svc.get_or_generate(fp, kdir, rag, config)
        if summary is not None:
            results.append({"file_path": fp, "summary": summary})
    return results
