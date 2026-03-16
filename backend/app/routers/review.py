"""Review API router — GET /review/due, POST /review/record, GET /review/stats."""
import logging
from typing import TYPE_CHECKING, Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models import ReviewQuality

if TYPE_CHECKING:
    from app.services.spaced_repetition_service import SpacedRepetitionService

logger = logging.getLogger(__name__)

router = APIRouter()

_srs: Optional["SpacedRepetitionService"] = None


def init_review_router(srs: "SpacedRepetitionService") -> None:
    global _srs
    _srs = srs


def _reset_review_router() -> None:
    global _srs
    _srs = None


def _get_service() -> "SpacedRepetitionService":
    if _srs is None:
        raise HTTPException(status_code=503, detail="Review service not available")
    return _srs


class RecordReviewRequest(BaseModel):
    item_id: int
    quality: int  # 0-4


@router.get("/review/due")
async def get_due() -> list[dict[str, Any]]:
    """Return all items due for review today."""
    svc = _get_service()
    items = await svc.get_due_items()
    return [item.model_dump() for item in items]


@router.post("/review/record")
async def record_review(body: RecordReviewRequest) -> dict[str, Any]:
    """Record a review result and update SM-2 scheduling."""
    svc = _get_service()

    try:
        quality = ReviewQuality(body.quality)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Invalid quality value: {body.quality}. Must be 0-4.")

    try:
        updated = await svc.record_review(body.item_id, quality)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

    return updated.model_dump()


@router.get("/review/stats")
async def get_stats() -> dict[str, int]:
    """Return review statistics."""
    svc = _get_service()
    return await svc.get_stats()
