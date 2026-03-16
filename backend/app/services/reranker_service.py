"""RerankerService — CrossEncoder download/load and rerank method."""
import asyncio
import logging
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

# Default cross-encoder model
RERANKER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
RERANKER_SIZE_MB = 80


class RerankerService:
    """Manages a CrossEncoder model: download, load, and rerank chunks."""

    def __init__(self, models_dir: Path = Path("./reranker_models")):
        self._models_dir = models_dir
        self._models_dir.mkdir(parents=True, exist_ok=True)
        self._model: Any = None
        self._download_progress: dict[str, Any] = {}

    def is_model_downloaded(self) -> bool:
        """Check if the reranker model is downloaded (model dir exists and is non-empty)."""
        local_name = RERANKER_MODEL.split("/")[-1]
        model_dir = self._models_dir / local_name
        if not model_dir.exists():
            return False
        return any(model_dir.iterdir())

    def get_download_status(self) -> Optional[dict[str, Any]]:
        """Return current download progress, or None if not downloading."""
        return self._download_progress if self._download_progress else None

    def get_status(self) -> dict[str, Any]:
        """Return model status info."""
        return {
            "model": RERANKER_MODEL,
            "size_mb": RERANKER_SIZE_MB,
            "downloaded": self.is_model_downloaded(),
            "loaded": self._model is not None,
        }

    async def download_model(self) -> None:
        """Download the CrossEncoder model in a thread. Updates _download_progress."""
        from sentence_transformers import CrossEncoder

        self._download_progress = {"status": "downloading", "progress": 0.0}
        try:
            model = await asyncio.to_thread(
                CrossEncoder, RERANKER_MODEL, cache_folder=str(self._models_dir)
            )
            self._model = model
            self._download_progress = {"status": "complete", "progress": 1.0}
        except Exception as e:
            self._download_progress = {"status": "error", "progress": 0.0, "error": str(e)}
            raise

    def load_model(self) -> None:
        """Load the CrossEncoder model into memory (synchronous)."""
        from sentence_transformers import CrossEncoder

        self._model = CrossEncoder(RERANKER_MODEL, cache_folder=str(self._models_dir))

    def rerank(
        self, query: str, chunks: list[dict[str, Any]], top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Rerank chunks by relevance to query using CrossEncoder.

        Args:
            query: The search query.
            chunks: List of dicts with at least a 'content' key.
            top_k: Number of top chunks to return after reranking.

        Returns:
            Top-k chunks sorted by relevance score (highest first).
        """
        if not self._model:
            raise RuntimeError("Reranker model not loaded. Call download_model() or load_model() first.")

        if not chunks:
            return []

        # Build query-document pairs for the cross-encoder
        pairs = [[query, chunk["content"]] for chunk in chunks]
        scores = self._model.predict(pairs)

        # Attach scores and sort descending
        scored_chunks = []
        for chunk, score in zip(chunks, scores):
            scored_chunk = {**chunk, "rerank_score": float(score)}
            scored_chunks.append(scored_chunk)

        scored_chunks.sort(key=lambda c: c["rerank_score"], reverse=True)
        return scored_chunks[:top_k]
