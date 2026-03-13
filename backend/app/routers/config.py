"""Config API endpoints — GET/PUT /config, POST /config/test-llm."""
from pathlib import Path
from typing import TYPE_CHECKING, Optional

import httpx
from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.config import AppConfig, LLMProvider, load_config, save_config

if TYPE_CHECKING:
    from app.services.embedding_service import EmbeddingService
    from app.services.ingest_service import IngestService

router = APIRouter()

# Set by create_app() via init_config_router()
_config_path: Path = Path("config.yaml")
_ingest_service: Optional["IngestService"] = None
_embedding_service: Optional["EmbeddingService"] = None
_knowledge_dir: Path = Path("./knowledge")


def init_config_router(config_path: Path) -> None:
    global _config_path
    _config_path = config_path


def init_reembed_dependencies(
    ingest_service: Optional["IngestService"],
    embedding_service: Optional["EmbeddingService"],
    knowledge_dir: Optional[Path] = None,
) -> None:
    global _ingest_service, _embedding_service, _knowledge_dir
    _ingest_service = ingest_service
    _embedding_service = embedding_service
    if knowledge_dir is not None:
        _knowledge_dir = knowledge_dir


@router.get("/config")
def get_config_endpoint() -> dict:
    cfg = load_config(_config_path)
    return cfg.model_dump()


@router.put("/config")
async def put_config_endpoint(config: AppConfig, background_tasks: BackgroundTasks) -> dict:
    old_cfg = load_config(_config_path)
    language_changed = old_cfg.embedding_language != config.embedding_language
    save_config(config, _config_path)
    result = config.model_dump()

    if language_changed and _embedding_service is not None and _ingest_service is not None:
        new_ef = _embedding_service.get_embedding_function(config.embedding_language)
        background_tasks.add_task(
            _embedding_service.reembed_all,
            new_language=config.embedding_language,
            ingest_service=_ingest_service,
            knowledge_dir=_knowledge_dir,
            embedding_function=new_ef,
        )
        result["reembedding"] = True
    else:
        result["reembedding"] = False

    return result


@router.post("/config/test-llm")
async def test_llm_endpoint() -> dict:
    cfg = load_config(_config_path)

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            if cfg.llm_provider == LLMProvider.OLLAMA:
                url = f"{cfg.base_url.rstrip('/')}/api/tags"
                resp = await client.get(url)
            elif cfg.llm_provider == LLMProvider.ANTHROPIC:
                url = f"{cfg.base_url.rstrip('/')}/v1/models"
                headers = {"anthropic-version": "2023-06-01"}
                if cfg.api_key:
                    headers["x-api-key"] = cfg.api_key
                resp = await client.get(url, headers=headers)
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
