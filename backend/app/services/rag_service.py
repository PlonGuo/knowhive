"""RAG query service — Chroma retrieval, prompt assembly, LLM call."""
import logging
from typing import Any

import httpx

from app.config import AppConfig, LLMProvider

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a helpful AI assistant for a personal knowledge base. "
    "Answer the user's question based on the provided context from their documents. "
    "If the context doesn't contain relevant information, say so honestly. "
    "Cite the source file paths when referencing specific information."
)


class RAGService:
    """Chroma retrieval + prompt assembly + LLM call."""

    def __init__(self, collection: Any):
        self._collection = collection

    # ── Retrieval ─────────────────────────────────────────────

    def retrieve(self, query: str, k: int = 5) -> list[dict[str, Any]]:
        """Query Chroma for top-k similar chunks."""
        results = self._collection.query(query_texts=[query], n_results=k)

        chunks = []
        for doc, meta in zip(results["documents"][0], results["metadatas"][0]):
            chunks.append({
                "content": doc,
                "file_path": meta["file_path"],
                "chunk_index": meta["chunk_index"],
            })
        return chunks

    # ── Source extraction ─────────────────────────────────────

    @staticmethod
    def extract_sources(chunks: list[dict[str, Any]]) -> list[str]:
        """Extract unique file paths from chunks, preserving order."""
        seen: set[str] = set()
        sources: list[str] = []
        for chunk in chunks:
            fp = chunk["file_path"]
            if fp not in seen:
                seen.add(fp)
                sources.append(fp)
        return sources

    # ── Prompt assembly ───────────────────────────────────────

    @staticmethod
    def build_prompt(
        question: str, chunks: list[dict[str, Any]]
    ) -> list[dict[str, str]]:
        """Build chat messages with system prompt, context, and user question."""
        if chunks:
            context_parts = []
            for chunk in chunks:
                context_parts.append(
                    f"[Source: {chunk['file_path']}]\n{chunk['content']}"
                )
            context_block = "\n\n".join(context_parts)
            user_content = (
                f"Context from knowledge base:\n\n{context_block}\n\n"
                f"Question: {question}"
            )
        else:
            user_content = (
                f"No relevant context was found in the knowledge base.\n\n"
                f"Question: {question}"
            )

        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_content},
        ]

    # ── LLM call ──────────────────────────────────────────────

    async def call_llm(
        self, messages: list[dict[str, str]], config: AppConfig
    ) -> str:
        """Send messages to LLM and return the response text."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                if config.llm_provider == LLMProvider.OLLAMA:
                    url = f"{config.base_url.rstrip('/')}/api/chat"
                    resp = await client.post(
                        url,
                        json={
                            "model": config.model_name,
                            "messages": messages,
                            "stream": False,
                        },
                    )
                else:
                    # OpenAI-compatible
                    url = f"{config.base_url.rstrip('/')}/chat/completions"
                    headers: dict[str, str] = {}
                    if config.api_key:
                        headers["Authorization"] = f"Bearer {config.api_key}"
                    resp = await client.post(
                        url,
                        json={
                            "model": config.model_name,
                            "messages": messages,
                            "stream": False,
                        },
                        headers=headers,
                    )

                if resp.status_code != 200:
                    raise RuntimeError(
                        f"LLM returned status {resp.status_code}: {resp.text}"
                    )

                data = resp.json()
                if config.llm_provider == LLMProvider.OLLAMA:
                    return data["message"]["content"]
                else:
                    return data["choices"][0]["message"]["content"]

        except httpx.ConnectError as e:
            raise ConnectionError(f"LLM connection failed: {e}") from e

    # ── Full query pipeline ───────────────────────────────────

    async def query(
        self, question: str, config: AppConfig, k: int = 5
    ) -> dict[str, Any]:
        """Full RAG pipeline: retrieve → build_prompt → call_llm → return answer + sources."""
        chunks = self.retrieve(question, k=k)
        sources = self.extract_sources(chunks)
        messages = self.build_prompt(question, chunks)
        answer = await self.call_llm(messages, config)
        return {"answer": answer, "sources": sources}
