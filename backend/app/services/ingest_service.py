"""Ingest service — load Markdown/PDF, split, embed, store in Chroma, dedup by file_path."""
import hashlib
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

import chromadb
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.database import get_db
from app.services.frontmatter_parser import FrontmatterData, parse_frontmatter
from app.services.pdf_extractor import extract_pdf_text

logger = logging.getLogger(__name__)

# Default splitter settings per PRD
CHUNK_SIZE = 1000
CHUNK_OVERLAP = 200


class IngestService:
    """Handles Markdown ingestion: load → split → embed → Chroma store with dedup."""

    def __init__(
        self,
        chroma_path: str = "./chroma_data",
        collection_name: str = "knowhive",
        embedding_function: Optional[Any] = None,
    ):
        self._client = chromadb.PersistentClient(path=chroma_path)
        create_kwargs: dict[str, Any] = {"name": collection_name}
        if embedding_function is not None:
            create_kwargs["embedding_function"] = embedding_function
        try:
            self._collection = self._client.get_or_create_collection(**create_kwargs)
        except ValueError as e:
            # Existing collection has a different embedding function configured.
            # Fall back to opening without specifying one (use persisted config).
            if "embedding function" in str(e).lower() and embedding_function is not None:
                logger.warning(
                    "Embedding function conflict on collection '%s': %s. "
                    "Opening with persisted embedding function.",
                    collection_name, e,
                )
                self._collection = self._client.get_or_create_collection(name=collection_name)
            else:
                raise
        self._splitter = RecursiveCharacterTextSplitter(
            chunk_size=CHUNK_SIZE,
            chunk_overlap=CHUNK_OVERLAP,
        )

    @property
    def collection(self) -> chromadb.Collection:
        return self._collection

    # ── File discovery ───────────────────────────────────────────

    SUPPORTED_EXTENSIONS = {".md", ".pdf"}

    @staticmethod
    def find_markdown_files(directory: Path) -> list[Path]:
        """Recursively find all .md files in directory."""
        return sorted(directory.rglob("*.md"))

    @staticmethod
    def find_ingestable_files(directory: Path) -> list[Path]:
        """Recursively find all supported files (.md, .pdf) in directory."""
        files: list[Path] = []
        for ext in sorted(IngestService.SUPPORTED_EXTENSIONS):
            files.extend(directory.rglob(f"*{ext}"))
        return sorted(files)

    # ── Text splitting ───────────────────────────────────────────

    def split_text(self, text: str, metadata: Optional[dict] = None) -> list[Document]:
        """Split text into chunks with metadata including chunk_index."""
        base_meta = metadata or {}
        docs = self._splitter.create_documents([text], metadatas=[base_meta])
        # Add chunk_index to each document
        for i, doc in enumerate(docs):
            doc.metadata["chunk_index"] = i
        return docs

    # ── File hashing ─────────────────────────────────────────────

    @staticmethod
    def compute_file_hash(file_path: Path) -> str:
        """Compute SHA-256 hash of file content."""
        return hashlib.sha256(file_path.read_bytes()).hexdigest()

    # ── Chroma operations ────────────────────────────────────────

    def store_chunks(self, chunks: list[Document]) -> None:
        """Store document chunks in Chroma collection."""
        if not chunks:
            return
        ids = [str(uuid.uuid4()) for _ in chunks]
        documents = [c.page_content for c in chunks]
        metadatas = [c.metadata for c in chunks]
        self._collection.add(ids=ids, documents=documents, metadatas=metadatas)

    def delete_chunks_for_file(self, file_path: str) -> None:
        """Delete all chunks for a given file_path (dedup before re-ingest)."""
        try:
            existing = self._collection.get(where={"file_path": file_path})
            if existing["ids"]:
                self._collection.delete(ids=existing["ids"])
        except Exception:
            # No matching documents — nothing to delete
            pass

    def rename_chunks_file_path(self, old_path: str, new_path: str) -> None:
        """Update file_path metadata for all chunks belonging to a file."""
        try:
            existing = self._collection.get(where={"file_path": old_path})
            if existing["ids"]:
                new_metadatas = []
                for meta in existing["metadatas"]:
                    updated = dict(meta)
                    updated["file_path"] = new_path
                    new_metadatas.append(updated)
                self._collection.update(ids=existing["ids"], metadatas=new_metadatas)
        except Exception:
            pass

    # ── Full ingest pipeline ─────────────────────────────────────

    async def ingest_file(self, file_path: Path, base_dir: Path) -> dict[str, Any]:
        """Ingest a single file (Markdown or PDF): read, hash, dedup, split, store, update DB."""
        file_path_str = str(file_path)

        try:
            if not file_path.exists():
                raise FileNotFoundError(f"File not found: {file_path}")

            # Extract text based on file type
            frontmatter = FrontmatterData()
            if file_path.suffix.lower() == ".pdf":
                content = extract_pdf_text(file_path)
            else:
                raw_content = file_path.read_text(encoding="utf-8")
                frontmatter, content = parse_frontmatter(raw_content)

            file_hash = self.compute_file_hash(file_path)
            file_size = file_path.stat().st_size
            modified_at = datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()

            # Check if file already exists in DB with same hash (skip if unchanged)
            async with get_db() as db:
                cursor = await db.execute(
                    "SELECT id, file_hash FROM documents WHERE file_path = ?",
                    (file_path_str,),
                )
                existing = await cursor.fetchone()

                if existing and existing["file_hash"] == file_hash:
                    return {"file_path": file_path_str, "status": "skipped", "chunk_count": 0}

                # Dedup: remove old Chroma chunks for this file
                self.delete_chunks_for_file(file_path_str)

                # Build chunk metadata with frontmatter fields
                chunk_meta: dict[str, Any] = {"file_path": file_path_str}
                tags_str = ",".join(frontmatter.tags) if frontmatter.tags else None
                for key, val in [
                    ("title", frontmatter.title),
                    ("category", frontmatter.category),
                    ("tags", tags_str),
                    ("difficulty", frontmatter.difficulty),
                    ("pack_id", frontmatter.pack_id),
                ]:
                    if val is not None:
                        chunk_meta[key] = val

                # Split and store
                chunks = self.split_text(content, metadata=chunk_meta)
                self.store_chunks(chunks)
                chunk_count = len(chunks)
                indexed_at = datetime.now().isoformat()

                # Upsert DB record (including frontmatter fields)
                if existing:
                    await db.execute(
                        """UPDATE documents
                           SET file_hash = ?, file_size = ?, modified_at = ?,
                               indexed_at = ?, chunk_count = ?, status = 'indexed',
                               error_message = NULL, updated_at = datetime('now'),
                               title = ?, category = ?, tags = ?, difficulty = ?, pack_id = ?
                           WHERE file_path = ?""",
                        (file_hash, file_size, modified_at, indexed_at, chunk_count,
                         frontmatter.title, frontmatter.category, tags_str,
                         frontmatter.difficulty, frontmatter.pack_id, file_path_str),
                    )
                else:
                    await db.execute(
                        """INSERT INTO documents
                           (file_path, file_name, file_size, file_hash, modified_at, indexed_at,
                            chunk_count, status, title, category, tags, difficulty, pack_id)
                           VALUES (?, ?, ?, ?, ?, ?, ?, 'indexed', ?, ?, ?, ?, ?)""",
                        (file_path_str, file_path.name, file_size, file_hash, modified_at, indexed_at,
                         chunk_count, frontmatter.title, frontmatter.category, tags_str,
                         frontmatter.difficulty, frontmatter.pack_id),
                    )
                await db.commit()

            logger.info("Ingested %s: %d chunks", file_path_str, chunk_count)
            return {"file_path": file_path_str, "status": "indexed", "chunk_count": chunk_count}

        except Exception as e:
            logger.error("Failed to ingest %s: %s", file_path_str, e)
            # Record error in DB if possible
            try:
                async with get_db() as db:
                    cursor = await db.execute(
                        "SELECT id FROM documents WHERE file_path = ?", (file_path_str,)
                    )
                    existing = await cursor.fetchone()
                    if existing:
                        await db.execute(
                            """UPDATE documents SET status = 'error', error_message = ?,
                               updated_at = datetime('now') WHERE file_path = ?""",
                            (str(e), file_path_str),
                        )
                    else:
                        await db.execute(
                            """INSERT INTO documents (file_path, file_name, modified_at, status, error_message)
                               VALUES (?, ?, datetime('now'), 'error', ?)""",
                            (file_path_str, file_path.name, str(e)),
                        )
                    await db.commit()
            except Exception:
                pass
            return {"file_path": file_path_str, "status": "error", "error": str(e)}

    async def ingest_directory(self, directory: Path) -> list[dict[str, Any]]:
        """Ingest all supported files (.md, .pdf) in a directory."""
        files = self.find_ingestable_files(directory)
        results = []
        for f in files:
            result = await self.ingest_file(f, directory)
            results.append(result)
        return results
