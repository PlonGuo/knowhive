"""Setup/onboarding API endpoints — GET /setup/status, POST /setup/complete."""
import logging
import shutil
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter

from app.config import load_config, save_config

logger = logging.getLogger(__name__)

router = APIRouter()

_config_path: Optional[Path] = None


def init_setup_router(config_path: Path) -> None:
    global _config_path
    _config_path = config_path


def _reset_setup_router() -> None:
    global _config_path
    _config_path = None


@router.get("/setup/status")
async def get_setup_status() -> dict:
    """Return environment readiness checks for the onboarding wizard."""
    uv_ok = shutil.which("uv") is not None
    cfg_for_status = load_config(_config_path) if _config_path else None
    first_run = cfg_for_status is None or not cfg_for_status.first_run_complete

    # Check Ollama connectivity if provider is ollama
    ollama_ok = False
    try:
        cfg = cfg_for_status
        if cfg is None or cfg.llm_provider == "ollama":
            async with httpx.AsyncClient(timeout=2.0) as client:
                resp = await client.get(f"{cfg.base_url if cfg else 'http://localhost:11434'}/api/tags")
                ollama_ok = resp.status_code == 200
        else:
            # Non-Ollama providers don't need local Ollama running
            ollama_ok = True
    except Exception:
        ollama_ok = False

    return {
        "python_ok": True,  # If we're running, Python works
        "uv_ok": uv_ok,
        "ollama_ok": ollama_ok,
        "first_run": first_run,
    }


@router.post("/setup/complete")
async def post_setup_complete() -> dict:
    """Mark onboarding as complete by setting first_run_complete=True in config."""
    if _config_path is not None:
        cfg = load_config(_config_path)
        cfg = cfg.model_copy(update={"first_run_complete": True})
        save_config(cfg, _config_path)
    return {"ok": True}
