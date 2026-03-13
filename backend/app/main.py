"""
KnowHive FastAPI sidecar — entry point.

Usage:
    uv run python -m app.main --port 18234
"""
import argparse
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI

from app.logging_config import setup_logging
from app.routers.config import init_config_router
from app.routers.config import router as config_router
from app.routers.ingest import router as ingest_router

APP_VERSION = "0.1.0"

DEFAULT_CONFIG_PATH = Path.home() / "Library" / "Application Support" / "knowhive" / "config.yaml"


def create_app(config_path: Optional[Path] = None) -> FastAPI:
    app = FastAPI(title="KnowHive Backend", version=APP_VERSION)

    init_config_router(config_path or DEFAULT_CONFIG_PATH)
    app.include_router(config_router)
    app.include_router(ingest_router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": APP_VERSION}

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="KnowHive backend sidecar")
    parser.add_argument(
        "--port",
        type=int,
        default=18234,
        help="Port to listen on (default: 18234)",
    )
    args = parser.parse_args()

    setup_logging()

    uvicorn.run(
        create_app(),
        host="127.0.0.1",
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
