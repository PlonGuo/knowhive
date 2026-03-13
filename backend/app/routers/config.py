"""Config API endpoints — GET/PUT /config, POST /config/test-llm."""
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException

from app.config import AppConfig, LLMProvider, load_config, save_config

router = APIRouter()

# Set by create_app() via init_config_router()
_config_path: Path = Path("config.yaml")


def init_config_router(config_path: Path) -> None:
    global _config_path
    _config_path = config_path


@router.get("/config")
def get_config_endpoint() -> dict:
    cfg = load_config(_config_path)
    return cfg.model_dump()


@router.put("/config")
def put_config_endpoint(config: AppConfig) -> dict:
    save_config(config, _config_path)
    return config.model_dump()


@router.post("/config/test-llm")
async def test_llm_endpoint() -> dict:
    cfg = load_config(_config_path)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if cfg.llm_provider == LLMProvider.OLLAMA:
                url = f"{cfg.base_url.rstrip('/')}/api/tags"
                resp = await client.get(url)
            else:
                # OpenAI-compatible: GET /models
                url = f"{cfg.base_url.rstrip('/')}/models"
                headers = {}
                if cfg.api_key:
                    headers["Authorization"] = f"Bearer {cfg.api_key}"
                resp = await client.get(url, headers=headers)

            if resp.status_code == 200:
                return {"success": True, "message": "LLM connection successful"}
            else:
                return {
                    "success": False,
                    "error": f"LLM returned status {resp.status_code}",
                }
    except httpx.ConnectError as e:
        return {"success": False, "error": f"Connection failed: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
