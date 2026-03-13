"""RAG query service — Chroma retrieval, prompt assembly, LLM call."""
import json
import logging
import os
from typing import Any, AsyncGenerator

import httpx

from app.config import AppConfig, LLMProvider

logger = logging.getLogger(__name__)

# Langfuse is optional — only used when env vars are set
try:
    from langfuse import Langfuse
except ImportError:
    Langfuse = None

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
        self._langfuse = self._init_langfuse()

    @staticmethod
    def _init_langfuse():
        """Initialize Langfuse client if env vars are set."""
        if Langfuse is None:
            return None
        public_key = os.environ.get("LANGFUSE_PUBLIC_KEY")
        secret_key = os.environ.get("LANGFUSE_SECRET_KEY")
        if not public_key or not secret_key:
            return None
        try:
            return Langfuse()
        except Exception:
            logger.warning("Failed to initialize Langfuse client", exc_info=True)
            return None

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

    # ── Anthropic helpers ─────────────────────────────────────

    @staticmethod
    def _prepare_anthropic(
        messages: list[dict[str, str]], config: AppConfig
    ) -> tuple[str, dict[str, str], dict]:
        """Build Anthropic-specific URL, headers, and JSON body.

        Extracts system message from the messages list into the top-level
        ``system`` field required by the Anthropic Messages API.
        """
        url = f"{config.base_url.rstrip('/')}/v1/messages"
        headers = {
            "x-api-key": config.api_key or "",
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        # Separate system message from user/assistant messages
        system_text = None
        api_messages = []
        for m in messages:
            if m["role"] == "system":
                system_text = m["content"]
            else:
                api_messages.append(m)
        body: dict = {
            "model": config.model_name,
            "max_tokens": 4096,
            "messages": api_messages,
        }
        if system_text:
            body["system"] = system_text
        return url, headers, body

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
                elif config.llm_provider == LLMProvider.ANTHROPIC:
                    url, headers, body = self._prepare_anthropic(messages, config)
                    body["stream"] = False
                    resp = await client.post(url, json=body, headers=headers)
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
                elif config.llm_provider == LLMProvider.ANTHROPIC:
                    return data["content"][0]["text"]
                else:
                    return data["choices"][0]["message"]["content"]

        except httpx.ConnectError as e:
            raise ConnectionError(f"LLM connection failed: {e}") from e

    # ── LLM streaming call ─────────────────────────────────────

    async def call_llm_stream(
        self, messages: list[dict[str, str]], config: AppConfig
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from LLM. Yields individual content tokens."""
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                if config.llm_provider == LLMProvider.OLLAMA:
                    url = f"{config.base_url.rstrip('/')}/api/chat"
                    async with client.stream(
                        "POST",
                        url,
                        json={
                            "model": config.model_name,
                            "messages": messages,
                            "stream": True,
                        },
                    ) as resp:
                        if resp.status_code != 200:
                            raise RuntimeError(
                                f"LLM returned status {resp.status_code}"
                            )
                        async for line in resp.aiter_lines():
                            if not line:
                                continue
                            data = json.loads(line)
                            content = data.get("message", {}).get("content", "")
                            if content:
                                yield content
                elif config.llm_provider == LLMProvider.ANTHROPIC:
                    url, headers, body = self._prepare_anthropic(messages, config)
                    body["stream"] = True
                    async with client.stream(
                        "POST", url, json=body, headers=headers,
                    ) as resp:
                        if resp.status_code != 200:
                            raise RuntimeError(
                                f"LLM returned status {resp.status_code}"
                            )
                        async for line in resp.aiter_lines():
                            if not line or not line.startswith("data: "):
                                continue
                            payload = line[6:]
                            data = json.loads(payload)
                            if data.get("type") == "content_block_delta":
                                text = data.get("delta", {}).get("text", "")
                                if text:
                                    yield text
                            elif data.get("type") == "message_stop":
                                break
                else:
                    # OpenAI-compatible SSE
                    url = f"{config.base_url.rstrip('/')}/chat/completions"
                    headers: dict[str, str] = {}
                    if config.api_key:
                        headers["Authorization"] = f"Bearer {config.api_key}"
                    async with client.stream(
                        "POST",
                        url,
                        json={
                            "model": config.model_name,
                            "messages": messages,
                            "stream": True,
                        },
                        headers=headers,
                    ) as resp:
                        if resp.status_code != 200:
                            raise RuntimeError(
                                f"LLM returned status {resp.status_code}"
                            )
                        async for line in resp.aiter_lines():
                            if not line or not line.startswith("data: "):
                                continue
                            payload = line[6:]
                            if payload == "[DONE]":
                                break
                            data = json.loads(payload)
                            delta = data["choices"][0].get("delta", {})
                            content = delta.get("content", "")
                            if content:
                                yield content

        except httpx.ConnectError as e:
            raise ConnectionError(f"LLM connection failed: {e}") from e

    # ── Full query pipeline ───────────────────────────────────

    async def query(
        self, question: str, config: AppConfig, k: int = 5
    ) -> dict[str, Any]:
        """Full RAG pipeline: retrieve → build_prompt → call_llm → return answer + sources."""
        trace = None
        if self._langfuse:
            try:
                trace = self._langfuse.trace(
                    name="rag-query",
                    input=question,
                    metadata={"k": k, "provider": config.llm_provider.value},
                )
            except Exception:
                logger.warning("Langfuse trace creation failed", exc_info=True)

        # Retrieval
        retrieval_span = None
        if trace:
            try:
                retrieval_span = trace.span(
                    name="retrieval",
                    input={"query": question, "k": k},
                )
            except Exception:
                logger.warning("Langfuse retrieval span failed", exc_info=True)

        chunks = self.retrieve(question, k=k)
        sources = self.extract_sources(chunks)

        if retrieval_span:
            try:
                retrieval_span.end(output={"num_chunks": len(chunks), "sources": sources})
            except Exception:
                logger.warning("Langfuse retrieval span end failed", exc_info=True)

        # Prompt assembly
        messages = self.build_prompt(question, chunks)

        # LLM call
        generation = None
        if trace:
            try:
                generation = trace.generation(
                    name="llm-call",
                    model=config.model_name,
                    input=messages,
                    metadata={"provider": config.llm_provider.value},
                )
            except Exception:
                logger.warning("Langfuse generation creation failed", exc_info=True)

        answer = await self.call_llm(messages, config)

        if generation:
            try:
                generation.end(output=answer)
            except Exception:
                logger.warning("Langfuse generation end failed", exc_info=True)

        # Finalize trace
        if trace:
            try:
                trace.update(output={"answer": answer, "sources": sources})
            except Exception:
                logger.warning("Langfuse trace update failed", exc_info=True)

        return {"answer": answer, "sources": sources}
