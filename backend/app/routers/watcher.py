"""Watcher API endpoints — GET /watcher/status, POST /watcher/toggle."""
import logging
from typing import TYPE_CHECKING, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

if TYPE_CHECKING:
    from app.services.watcher_bridge import WatcherBridge

logger = logging.getLogger(__name__)

router = APIRouter()

_bridge: Optional["WatcherBridge"] = None


def init_watcher_router(bridge: "WatcherBridge") -> None:
    global _bridge
    _bridge = bridge


def _reset_watcher_router() -> None:
    global _bridge
    _bridge = None


def _get_bridge() -> "WatcherBridge":
    if _bridge is None:
        raise HTTPException(status_code=503, detail="File watcher not available")
    return _bridge


class ToggleRequest(BaseModel):
    enabled: bool


@router.get("/watcher/status")
async def watcher_status() -> dict:
    bridge = _get_bridge()
    return bridge.status()


@router.post("/watcher/toggle")
async def watcher_toggle(body: ToggleRequest) -> dict:
    bridge = _get_bridge()
    if body.enabled:
        bridge.start()
    else:
        bridge.stop()
    return bridge.status()
