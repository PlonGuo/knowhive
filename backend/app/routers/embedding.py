"""Embedding API endpoints — model list, download, status."""
import asyncio
import logging
from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app.config import EmbeddingLanguage

if TYPE_CHECKING:
    from app.services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)

router = APIRouter()

_embedding_service: Optional["EmbeddingService"] = None


def init_embedding_router(embedding_service: "EmbeddingService") -> None:
    global _embedding_service
    _embedding_service = embedding_service


def _reset_embedding_router() -> None:
    global _embedding_service
    _embedding_service = None


def _get_service() -> "EmbeddingService":
    if _embedding_service is None:
        raise HTTPException(status_code=503, detail="Embedding service not available")
    return _embedding_service


class DownloadRequest(BaseModel):
    language: EmbeddingLanguage


@router.get("/embedding/models")
async def get_models() -> list[dict]:
    """Return all available embedding models with download status."""
    svc = _get_service()
    return svc.get_available_models()


@router.post("/embedding/download")
async def start_download(body: DownloadRequest, background_tasks: BackgroundTasks) -> dict:
    """Start downloading an embedding model in the background."""
    svc = _get_service()
    background_tasks.add_task(svc.download_model, body.language)
    return {"status": "started", "language": str(body.language)}


@router.get("/embedding/status")
async def get_status(language: EmbeddingLanguage) -> dict:
    """Return current download progress for a language."""
    svc = _get_service()
    progress = svc.get_download_status(language)
    if progress is None:
        return {"language": str(language), "status": None}
    return {"language": str(language), **progress}
