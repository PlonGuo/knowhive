"""Community API router — GET /community/packs, POST /community/import."""
import logging
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

if TYPE_CHECKING:
    from app.services.community_service import CommunityService

logger = logging.getLogger(__name__)

router = APIRouter()

_community_service: Optional["CommunityService"] = None
_knowledge_dir: Optional[Path] = None


def init_community_router(
    community_service: "CommunityService",
    knowledge_dir: Optional[Path] = None,
) -> None:
    global _community_service, _knowledge_dir
    _community_service = community_service
    _knowledge_dir = knowledge_dir


def _reset_community_router() -> None:
    global _community_service, _knowledge_dir
    _community_service = None
    _knowledge_dir = None


def _get_service() -> "CommunityService":
    if _community_service is None:
        raise HTTPException(status_code=503, detail="Community service not available")
    return _community_service


class ImportRequest(BaseModel):
    pack_id: str


@router.get("/community/packs")
async def get_packs() -> list[dict[str, Any]]:
    """Return all community packs with an `imported` field."""
    svc = _get_service()
    manifest = await svc.fetch_manifest()

    result = []
    for pack in manifest.packs:
        pack_dict = pack.model_dump()
        # Determine if already imported: pack dir exists and is non-empty
        if _knowledge_dir is not None:
            pack_dir = _knowledge_dir / pack.id
            pack_dict["imported"] = pack_dir.exists() and any(pack_dir.iterdir())
        else:
            pack_dict["imported"] = False
        result.append(pack_dict)

    return result


@router.post("/community/import")
async def import_pack(body: ImportRequest) -> dict[str, Any]:
    """Download a pack to knowledge/ and return task status."""
    svc = _get_service()
    manifest = await svc.fetch_manifest()

    # Find the pack
    pack = next((p for p in manifest.packs if p.id == body.pack_id), None)
    if pack is None:
        raise HTTPException(status_code=404, detail=f"Pack '{body.pack_id}' not found")

    result = await svc.import_pack(pack)
    task_id = str(uuid.uuid4())
    return {"task_id": task_id, **result}
