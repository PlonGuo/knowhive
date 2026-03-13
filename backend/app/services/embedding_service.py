"""EmbeddingService — model registry, download status, and embedding function factory."""
from pathlib import Path
from typing import Any, Optional

from chromadb.utils import embedding_functions

from app.config import EmbeddingLanguage

# Model registry: EmbeddingLanguage → {name, size_mb}
MODEL_REGISTRY: dict[EmbeddingLanguage, dict[str, Any]] = {
    EmbeddingLanguage.ENGLISH: {
        "name": "all-MiniLM-L6-v2",
        "size_mb": 80,
    },
    EmbeddingLanguage.CHINESE: {
        "name": "shibing624/text2vec-base-chinese",
        "size_mb": 400,
    },
    EmbeddingLanguage.MIXED: {
        "name": "BAAI/bge-m3",
        "size_mb": 1200,
    },
}


class EmbeddingService:
    """Manages embedding models: registry, download status, and embedding function creation."""

    def __init__(self, models_dir: Path = Path("./embedding_models")):
        self._models_dir = models_dir
        self._models_dir.mkdir(parents=True, exist_ok=True)
        # In-memory download progress: language → {progress, status}
        self._download_progress: dict[EmbeddingLanguage, dict[str, Any]] = {}

    def get_available_models(self) -> list[dict[str, Any]]:
        """Return list of all models with download status."""
        result = []
        for language, info in MODEL_REGISTRY.items():
            result.append({
                "language": str(language),
                "name": info["name"],
                "size_mb": info["size_mb"],
                "downloaded": self.is_model_downloaded(language),
            })
        return result

    def is_model_downloaded(self, language: EmbeddingLanguage) -> bool:
        """Check if a model is downloaded (model dir exists and is non-empty)."""
        model_name = MODEL_REGISTRY[language]["name"]
        # Use only the last part of the name for local dir (handles org/model format)
        local_name = model_name.split("/")[-1]
        model_dir = self._models_dir / local_name
        if not model_dir.exists():
            return False
        # Must be non-empty
        return any(model_dir.iterdir())

    def get_download_status(self, language: EmbeddingLanguage) -> Optional[dict[str, Any]]:
        """Return current download progress for a language, or None if not downloading."""
        return self._download_progress.get(language)

    def get_embedding_function(
        self, language: EmbeddingLanguage
    ) -> embedding_functions.SentenceTransformerEmbeddingFunction:
        """Return a chromadb SentenceTransformerEmbeddingFunction for the given language."""
        model_name = MODEL_REGISTRY[language]["name"]
        return embedding_functions.SentenceTransformerEmbeddingFunction(model_name=model_name)
