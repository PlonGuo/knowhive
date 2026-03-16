"""RAG query service — Chroma retrieval, prompt assembly, LLM call."""
import logging
import os
from typing import Any, AsyncGenerator

from app.config import AppConfig
from app.services.llm_factory import create_chat_model, dicts_to_messages

logger = logging.getLogger(__name__)

# Langfuse LangChain callback — optional, only used when env vars are set
try:
    from langfuse.langchain import CallbackHandler as LangfuseCallbackHandler
except ImportError:
    LangfuseCallbackHandler = None

SYSTEM_PROMPT = (
    "You are a helpful AI assistant for a personal knowledge base. "
    "Answer the user's question based on the provided context from their documents. "
    "If the context doesn't contain relevant information, say so honestly. "
    "Cite the source file paths when referencing specific information."
)


def get_langfuse_callback():
    """Create a Langfuse LangChain CallbackHandler if env vars are set."""
    if LangfuseCallbackHandler is None:
        return None
    public_key = os.environ.get("LANGFUSE_PUBLIC_KEY")
    secret_key = os.environ.get("LANGFUSE_SECRET_KEY")
    if not public_key or not secret_key:
        return None
    try:
        return LangfuseCallbackHandler()
    except Exception:
        logger.warning("Failed to create Langfuse callback handler", exc_info=True)
        return None


class RAGService:
    """Chroma retrieval + prompt assembly + LLM call."""

    def __init__(self, collection: Any):
        self._collection = collection

    # ── Retrieval ─────────────────────────────────────────────

    def retrieve(self, query: str, k: int = 5, where: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Query Chroma for top-k similar chunks, optionally filtered by metadata."""
        query_kwargs: dict[str, Any] = {"query_texts": [query], "n_results": k}
        if where is not None:
            query_kwargs["where"] = where
        results = self._collection.query(**query_kwargs)

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
        question: str,
        chunks: list[dict[str, Any]],
        custom_system_prompt: str = "",
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

        system_content = SYSTEM_PROMPT
        if custom_system_prompt:
            system_content = f"{SYSTEM_PROMPT}\n\n{custom_system_prompt}"

        return [
            {"role": "system", "content": system_content},
            {"role": "user", "content": user_content},
        ]

    # ── LLM call ──────────────────────────────────────────────

    async def call_llm(
        self, messages: list[dict[str, str]], config: AppConfig, callbacks: list | None = None
    ) -> str:
        """Send messages to LLM and return the response text."""
        try:
            model = create_chat_model(config)
            lc_messages = dicts_to_messages(messages)
            invoke_kwargs = {}
            if callbacks:
                invoke_kwargs["config"] = {"callbacks": callbacks}
            response = await model.ainvoke(lc_messages, **invoke_kwargs)
            return response.content
        except Exception as e:
            if "connect" in str(e).lower() or "connection" in str(e).lower():
                raise ConnectionError(f"LLM connection failed: {e}") from e
            raise

    # ── LLM streaming call ─────────────────────────────────────

    async def call_llm_stream(
        self, messages: list[dict[str, str]], config: AppConfig, callbacks: list | None = None
    ) -> AsyncGenerator[str, None]:
        """Stream tokens from LLM. Yields individual content tokens."""
        try:
            model = create_chat_model(config)
            lc_messages = dicts_to_messages(messages)
            stream_kwargs = {}
            if callbacks:
                stream_kwargs["config"] = {"callbacks": callbacks}
            async for chunk in model.astream(lc_messages, **stream_kwargs):
                if chunk.content:
                    yield chunk.content
        except Exception as e:
            if "connect" in str(e).lower() or "connection" in str(e).lower():
                raise ConnectionError(f"LLM connection failed: {e}") from e
            raise

    # ── Full query pipeline ───────────────────────────────────

    async def query(
        self, question: str, config: AppConfig, k: int = 5
    ) -> dict[str, Any]:
        """Full RAG pipeline: retrieve → build_prompt → call_llm → return answer + sources."""
        # Build Langfuse callback if env vars are set
        callbacks = []
        langfuse_cb = get_langfuse_callback()
        if langfuse_cb:
            callbacks.append(langfuse_cb)

        chunks = self.retrieve(question, k=k)
        sources = self.extract_sources(chunks)
        messages = self.build_prompt(question, chunks)
        answer = await self.call_llm(messages, config, callbacks=callbacks or None)

        return {"answer": answer, "sources": sources}
