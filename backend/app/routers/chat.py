"""Chat API — POST /chat (SSE streaming), GET/DELETE /chat/history."""
import asyncio
import json
import logging
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from app.config import AppConfig, load_config
from app.database import get_db
from app.services.memory_compression_service import compress_if_needed
from app.services.rag_graph import create_rag_prep_graph
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

router = APIRouter()

# Module-level state, set by init_chat_router()
_rag_service: Optional[RAGService] = None
_config_path = None
_reranker_service = None


def init_chat_router(rag_service: RAGService, config_path, reranker_service=None) -> None:
    """Initialize chat router with RAG service, config path, and optional reranker."""
    global _rag_service, _config_path, _reranker_service
    _rag_service = rag_service
    _config_path = config_path
    _reranker_service = reranker_service


def _get_rag_service() -> RAGService:
    if _rag_service is None:
        raise RuntimeError("Chat router not initialized. Call init_chat_router() first.")
    return _rag_service


def _get_config() -> AppConfig:
    if _config_path is None:
        raise RuntimeError("Chat router not initialized. Call init_chat_router() first.")
    return load_config(_config_path)


# ── Request/Response models ───────────────────────────────────────


class ChatRequest(BaseModel):
    question: str
    k: int = 5
    pack_id: Optional[str] = None

    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question must not be empty")
        return v


class ChatHistoryResponse(BaseModel):
    messages: list[dict]
    total: int


class DeleteHistoryResponse(BaseModel):
    deleted: int


# ── SSE streaming ─────────────────────────────────────────────────


async def _chat_stream(question: str, k: int, pack_id: Optional[str] = None) -> AsyncGenerator[str, None]:
    """Generate SSE events: token, sources, done (or error)."""
    rag = _get_rag_service()
    config = _get_config()

    # Use LangGraph prep graph for retrieve + build_prompt
    prep_graph = create_rag_prep_graph(rag, config, reranker_service=_reranker_service)
    state_input: dict = {
        "question": question,
        "k": k,
        "pre_retrieval_strategy": config.pre_retrieval_strategy.value,
        "use_reranker": config.use_reranker,
        "chat_memory_turns": config.chat_memory_turns,
        "custom_system_prompt": config.custom_system_prompt,
    }
    if pack_id is not None:
        state_input["pack_id"] = pack_id
    prep_result = await prep_graph.ainvoke(state_input)
    sources = prep_result["sources"]
    messages = prep_result["messages"]

    # Save user message to DB
    async with get_db() as db:
        await db.execute(
            "INSERT INTO chat_messages (role, content) VALUES (?, ?)",
            ("user", question),
        )
        await db.commit()

    # Stream tokens from LLM
    full_response = ""
    try:
        async for token in rag.call_llm_stream(messages, config):
            full_response += token
            yield f"event: token\ndata: {json.dumps({'token': token})}\n\n"

        # Sources event
        yield f"event: sources\ndata: {json.dumps({'sources': sources})}\n\n"

        # Done event
        yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"

        # Save assistant message to DB
        async with get_db() as db:
            await db.execute(
                "INSERT INTO chat_messages (role, content, sources) VALUES (?, ?, ?)",
                ("assistant", full_response, json.dumps(sources)),
            )
            await db.commit()

        # Trigger memory compression in the background
        asyncio.create_task(compress_if_needed(config))

    except Exception as e:
        logger.error("Chat stream error: %s", e)
        yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

        # Save partial response if any
        if full_response:
            async with get_db() as db:
                await db.execute(
                    "INSERT INTO chat_messages (role, content, sources) VALUES (?, ?, ?)",
                    ("assistant", full_response, json.dumps(sources)),
                )
                await db.commit()


# ── Endpoints ─────────────────────────────────────────────────────


@router.post("/chat")
async def chat(request: ChatRequest) -> StreamingResponse:
    """SSE streaming chat endpoint."""
    return StreamingResponse(
        _chat_stream(request.question, request.k, request.pack_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


@router.get("/chat/history")
async def get_history(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> ChatHistoryResponse:
    """Get chat message history with pagination."""
    async with get_db() as db:
        # Get total count
        cursor = await db.execute("SELECT COUNT(*) FROM chat_messages")
        row = await cursor.fetchone()
        total = row[0]

        # Get paginated messages
        cursor = await db.execute(
            "SELECT id, role, content, sources, created_at FROM chat_messages ORDER BY id LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()

    messages = []
    for r in rows:
        msg = {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "sources": json.loads(r["sources"]) if r["sources"] else None,
            "created_at": r["created_at"],
        }
        messages.append(msg)

    return ChatHistoryResponse(messages=messages, total=total)


@router.delete("/chat/history")
async def delete_history() -> DeleteHistoryResponse:
    """Delete all chat messages."""
    async with get_db() as db:
        cursor = await db.execute("SELECT COUNT(*) FROM chat_messages")
        row = await cursor.fetchone()
        count = row[0]

        await db.execute("DELETE FROM chat_messages")
        await db.execute("DELETE FROM chat_summaries")
        await db.commit()

    return DeleteHistoryResponse(deleted=count)
