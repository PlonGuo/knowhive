"""Reranker API endpoints — status, download, download-status."""
import logging
from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException

if TYPE_CHECKING:
    from app.services.reranker_service import RerankerService

logger = logging.getLogger(__name__)

router = APIRouter()

_reranker_service: Optional["RerankerService"] = None


def init_reranker_router(reranker_service: "RerankerService") -> None:
    global _reranker_service
    _reranker_service = reranker_service


def _reset_reranker_router() -> None:
    global _reranker_service
    _reranker_service = None


def _get_service() -> "RerankerService":
    if _reranker_service is None:
        raise HTTPException(status_code=503, detail="Reranker service not available")
    return _reranker_service


@router.get("/reranker/status")
async def get_status() -> dict:
    """Return reranker model status (model name, size, downloaded, loaded)."""
    svc = _get_service()
    return svc.get_status()


@router.post("/reranker/download")
async def start_download(background_tasks: BackgroundTasks) -> dict:
    """Start downloading the reranker model in the background."""
    svc = _get_service()
    background_tasks.add_task(svc.download_model)
    return {"status": "started"}


@router.get("/reranker/download-status")
async def get_download_status() -> dict:
    """Return current download progress."""
    svc = _get_service()
    progress = svc.get_download_status()
    if progress is None:
        return {"status": None}
    return progress
