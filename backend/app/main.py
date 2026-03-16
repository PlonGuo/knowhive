"""
KnowHive FastAPI sidecar — entry point.

Usage:
    uv run python -m app.main --port 18234
"""
import argparse
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI

from app.database import close_db, init_db
from app.logging_config import setup_logging
from app.routers.chat import init_chat_router
from app.routers.chat import router as chat_router
from app.routers.config import init_config_router, init_reembed_dependencies
from app.routers.config import router as config_router
from app.routers.ingest import init_ingest_router
from app.routers.ingest import router as ingest_router
from app.routers.knowledge import init_knowledge_router
from app.routers.knowledge import router as knowledge_router
from app.routers.summary import init_summary_router
from app.routers.summary import router as summary_router
from app.routers.review import init_review_router
from app.routers.review import router as review_router
from app.routers.embedding import init_embedding_router
from app.routers.embedding import router as embedding_router
from app.routers.reranker import init_reranker_router
from app.routers.reranker import router as reranker_router
from app.routers.community import init_community_router
from app.routers.community import router as community_router
from app.routers.export import init_export_router
from app.routers.export import router as export_router
from app.routers.setup import init_setup_router
from app.routers.setup import router as setup_router
from app.routers.watcher import init_watcher_router
from app.routers.watcher import router as watcher_router
from app.services.embedding_service import EmbeddingService
from app.services.reranker_service import RerankerService
from app.services.community_service import CommunityService
from app.services.spaced_repetition_service import SpacedRepetitionService
from app.services.summary_service import SummaryService
from app.services.export_service import ExportService
from app.services.ingest_service import IngestService
from app.services.rag_service import RAGService
from app.services.sync_service import SyncService
from app.services.watcher_bridge import WatcherBridge

logger = logging.getLogger(__name__)

APP_VERSION = "0.1.0"

DEFAULT_CONFIG_PATH = Path.home() / "Library" / "Application Support" / "knowhive" / "config.yaml"
DEFAULT_DB_PATH = "knowhive.db"
DEFAULT_CHROMA_PATH = "./chroma_data"
DEFAULT_KNOWLEDGE_DIR = "./knowledge"


def create_app(
    config_path: Optional[Path] = None,
    db_path: Optional[str] = None,
    chroma_path: Optional[str] = None,
    knowledge_dir: Optional[str] = None,
) -> FastAPI:
    _config_path = config_path or DEFAULT_CONFIG_PATH
    _db_path = db_path or DEFAULT_DB_PATH
    _chroma_path = chroma_path or DEFAULT_CHROMA_PATH
    _knowledge_dir = knowledge_dir or DEFAULT_KNOWLEDGE_DIR

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        # ── Startup ──────────────────────────────────────────
        logger.info("Initializing database at %s", _db_path)
        await init_db(_db_path)

        # Initialize embedding service + get embedding function for current config
        from app.config import load_config
        current_config = load_config(_config_path)
        embedding_service = EmbeddingService()
        init_embedding_router(embedding_service)
        reranker_service = RerankerService()
        init_reranker_router(reranker_service)
        embedding_fn = embedding_service.get_embedding_function(current_config.embedding_language)

        # Initialize services
        ingest_service = IngestService(chroma_path=_chroma_path, embedding_function=embedding_fn)
        rag_service = RAGService(collection=ingest_service.collection)

        # Initialize routers with dependencies
        init_setup_router(_config_path)
        init_config_router(_config_path)
        init_reembed_dependencies(
            ingest_service=ingest_service,
            embedding_service=embedding_service,
            knowledge_dir=Path(_knowledge_dir),
        )
        init_ingest_router(chroma_path=_chroma_path, knowledge_dir=_knowledge_dir)
        init_knowledge_router(knowledge_dir=_knowledge_dir, ingest_service=ingest_service)
        init_chat_router(rag_service=rag_service, config_path=_config_path, reranker_service=reranker_service)
        export_service = ExportService(
            knowledge_dir=Path(_knowledge_dir),
            config_path=_config_path,
            db_path=_db_path,
        )
        init_export_router(export_service, knowledge_dir=Path(_knowledge_dir))

        # Initialize community service
        community_service = CommunityService(knowledge_dir=Path(_knowledge_dir))
        init_community_router(community_service, knowledge_dir=Path(_knowledge_dir))

        # Initialize review service
        srs = SpacedRepetitionService()
        init_review_router(srs)

        # Initialize summary service
        summary_service = SummaryService()
        init_summary_router(summary_service, rag_service=rag_service, config_path=_config_path, knowledge_dir=Path(_knowledge_dir))

        # Run startup sync + start file watcher
        knowledge_path = Path(_knowledge_dir)
        watcher_bridge = None
        if knowledge_path.exists():
            sync_service = SyncService(ingest_service, knowledge_path)
            try:
                stats = await sync_service.sync()
                logger.info(
                    "Startup sync: %d new, %d modified, %d deleted",
                    stats["new"], stats["modified"], stats["deleted"],
                )
            except Exception:
                logger.exception("Startup sync failed")

            # Start file watcher
            watcher_bridge = WatcherBridge(sync_service, knowledge_path)
            init_watcher_router(watcher_bridge)
            watcher_bridge.start()
            logger.info("FileWatcher started")

        logger.info("KnowHive backend ready")
        yield

        # ── Shutdown ─────────────────────────────────────────
        if watcher_bridge is not None:
            watcher_bridge.stop()
            logger.info("FileWatcher stopped")
        await close_db()
        logger.info("KnowHive backend shut down")

    app = FastAPI(title="KnowHive Backend", version=APP_VERSION, lifespan=lifespan)

    app.include_router(setup_router)
    app.include_router(config_router)
    app.include_router(ingest_router)
    app.include_router(knowledge_router)
    app.include_router(chat_router)
    app.include_router(watcher_router)
    app.include_router(embedding_router)
    app.include_router(reranker_router)
    app.include_router(export_router)
    app.include_router(community_router)
    app.include_router(review_router)
    app.include_router(summary_router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok", "version": APP_VERSION}

    return app


def _resolve_data_paths(data_dir: Optional[str]) -> dict:
    """Return create_app() kwargs derived from a single data directory.

    Returns an empty dict when data_dir is None (dev mode uses CWD defaults).
    """
    if data_dir is None:
        return {}
    d = Path(data_dir)
    return {
        "config_path": d / "config.yaml",
        "db_path": str(d / "knowhive.db"),
        "chroma_path": str(d / "chroma_data"),
        "knowledge_dir": str(d / "knowledge"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="KnowHive backend sidecar")
    parser.add_argument(
        "--port",
        type=int,
        default=18234,
        help="Port to listen on (default: 18234)",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help="Directory for user data (db, chroma, knowledge, config). Defaults to CWD.",
    )
    args = parser.parse_args()

    setup_logging()

    if args.data_dir:
        Path(args.data_dir).mkdir(parents=True, exist_ok=True)

    path_kwargs = _resolve_data_paths(args.data_dir)
    uvicorn.run(
        create_app(**path_kwargs),
        host="127.0.0.1",
        port=args.port,
        log_level="info",
    )


# Module-level app instance for `uvicorn app.main:app --reload` (dev:all mode)
app = create_app()


if __name__ == "__main__":
    main()
