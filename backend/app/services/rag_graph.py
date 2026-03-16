"""LangGraph RAG StateGraph — [rewrite →] 3-way pre-retrieval → retrieve → [rerank →] build_prompt → generate → END."""
from __future__ import annotations

from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph

from app.config import AppConfig
from app.services.hyde_service import generate_hypothetical_doc
from app.services.multi_query_service import expand_queries
from app.services.query_rewriter import fetch_chat_context, rewrite_query
from app.services.rag_service import RAGService
from app.services.strategy_classifier import classify_query, classify_query_llm


class RAGState(TypedDict, total=False):
    """State flowing through the RAG graph."""

    question: str
    k: int
    pre_retrieval_strategy: str  # "none" | "hyde" | "multi_query"
    use_reranker: bool
    chat_memory_turns: int
    hypothetical_doc: str
    pack_id: str
    custom_system_prompt: str
    chunks: list[dict[str, Any]]
    sources: list[str]
    messages: list[dict[str, str]]
    answer: str


def _start_route(state: RAGState) -> Literal["rewrite_query", "route_pre_retrieval"]:
    """Route at START: rewrite_query if chat_memory_turns > 0, else skip to pre-retrieval."""
    if state.get("chat_memory_turns", 0) > 0:
        return "rewrite_query"
    return "route_pre_retrieval"


def _pre_retrieval_route(state: RAGState) -> Literal["hyde", "multi_query", "retrieve"]:
    """Route based on pre_retrieval_strategy: hyde, multi_query, or retrieve (default)."""
    strategy = state.get("pre_retrieval_strategy", "none")
    if strategy == "hyde":
        return "hyde"
    if strategy == "multi_query":
        return "multi_query"
    return "retrieve"


def _post_retrieve_route(state: RAGState) -> Literal["rerank", "build_prompt"]:
    """Route after retrieve: rerank if use_reranker is True, else build_prompt."""
    if state.get("use_reranker", False):
        return "rerank"
    return "build_prompt"


def _dedup_chunks(chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Deduplicate chunks by (file_path, chunk_index), preserving order."""
    seen: set[tuple[str, int]] = set()
    result = []
    for chunk in chunks:
        key = (chunk["file_path"], chunk["chunk_index"])
        if key not in seen:
            seen.add(key)
            result.append(chunk)
    return result


def _build_graph_nodes(rag_service, config, reranker_service=None):
    """Build common node functions shared by both full and prep graphs."""

    async def rewrite_query_node(state: RAGState) -> dict:
        n_turns = state.get("chat_memory_turns", 0)
        summaries, history = await fetch_chat_context(n_turns)
        rewritten = await rewrite_query(
            state["question"], history, config, summaries=summaries
        )
        return {"question": rewritten}

    async def route_pre_retrieval(state: RAGState) -> dict:
        """Routing fan-out point. Resolves auto/auto_llm to a concrete strategy."""
        strategy = state.get("pre_retrieval_strategy", "none")
        if strategy == "auto":
            resolved = classify_query(state["question"])
            return {"pre_retrieval_strategy": resolved}
        if strategy == "auto_llm":
            resolved = await classify_query_llm(state["question"], config)
            return {"pre_retrieval_strategy": resolved}
        return {}

    async def hyde(state: RAGState) -> dict:
        hypothetical = await generate_hypothetical_doc(state["question"], config)
        return {"hypothetical_doc": hypothetical}

    async def multi_query(state: RAGState) -> dict:
        k = state.get("k", 5)
        pack_id = state.get("pack_id")
        variants = await expand_queries(state["question"], config)
        all_chunks: list[dict[str, Any]] = []
        for variant in variants:
            retrieve_kwargs: dict[str, Any] = {"k": k}
            if pack_id:
                retrieve_kwargs["where"] = {"pack_id": pack_id}
            chunks = rag_service.retrieve(variant, **retrieve_kwargs)
            all_chunks.extend(chunks)
        deduped = _dedup_chunks(all_chunks)
        sources = rag_service.extract_sources(deduped)
        return {"chunks": deduped, "sources": sources}

    async def retrieve(state: RAGState) -> dict:
        k = state.get("k", 5)
        query = state.get("hypothetical_doc", state["question"])
        pack_id = state.get("pack_id")
        retrieve_kwargs: dict[str, Any] = {"k": k}
        if pack_id:
            retrieve_kwargs["where"] = {"pack_id": pack_id}
        chunks = rag_service.retrieve(query, **retrieve_kwargs)
        sources = rag_service.extract_sources(chunks)
        return {"chunks": chunks, "sources": sources}

    async def rerank(state: RAGState) -> dict:
        if reranker_service is None:
            return {}
        reranked = reranker_service.rerank(state["question"], state["chunks"])
        sources = rag_service.extract_sources(reranked)
        return {"chunks": reranked, "sources": sources}

    async def build_prompt(state: RAGState) -> dict:
        messages = rag_service.build_prompt(
            state["question"],
            state["chunks"],
            custom_system_prompt=state.get("custom_system_prompt", ""),
        )
        return {"messages": messages}

    return rewrite_query_node, route_pre_retrieval, hyde, multi_query, retrieve, rerank, build_prompt


def _add_common_edges(graph: StateGraph) -> None:
    """Add edges shared by both full and prep graphs."""
    # START → rewrite_query or route_pre_retrieval
    graph.add_conditional_edges(
        "__start__",
        _start_route,
        {"rewrite_query": "rewrite_query", "route_pre_retrieval": "route_pre_retrieval"},
    )
    # rewrite_query → route_pre_retrieval
    graph.add_edge("rewrite_query", "route_pre_retrieval")
    # route_pre_retrieval → 3-way fan-out
    graph.add_conditional_edges(
        "route_pre_retrieval",
        _pre_retrieval_route,
        {"hyde": "hyde", "multi_query": "multi_query", "retrieve": "retrieve"},
    )
    graph.add_edge("hyde", "retrieve")
    graph.add_conditional_edges(
        "multi_query",
        _post_retrieve_route,
        {"rerank": "rerank", "build_prompt": "build_prompt"},
    )
    graph.add_conditional_edges(
        "retrieve",
        _post_retrieve_route,
        {"rerank": "rerank", "build_prompt": "build_prompt"},
    )
    graph.add_edge("rerank", "build_prompt")


def create_rag_graph(rag_service: RAGService, config: AppConfig, reranker_service=None):
    """Build and compile the RAG StateGraph.

    Nodes: [rewrite_query →] route → [hyde|multi_query →] retrieve → [rerank →] build_prompt → generate → END
    """
    rewrite_query_node, route_pre_retrieval, hyde, multi_query, retrieve, rerank, build_prompt = \
        _build_graph_nodes(rag_service, config, reranker_service)

    async def generate(state: RAGState) -> dict:
        answer = await rag_service.call_llm(state["messages"], config)
        return {"answer": answer}

    graph = StateGraph(RAGState)
    graph.add_node("rewrite_query", rewrite_query_node)
    graph.add_node("route_pre_retrieval", route_pre_retrieval)
    graph.add_node("hyde", hyde)
    graph.add_node("multi_query", multi_query)
    graph.add_node("retrieve", retrieve)
    graph.add_node("rerank", rerank)
    graph.add_node("build_prompt", build_prompt)
    graph.add_node("generate", generate)

    _add_common_edges(graph)
    graph.add_edge("build_prompt", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


def create_rag_prep_graph(rag_service: RAGService, config: AppConfig | None = None, reranker_service=None):
    """Build a prep-only graph: [rewrite_query →] route → [hyde|multi_query →] retrieve → [rerank →] build_prompt → END."""
    rewrite_query_node, route_pre_retrieval, hyde, multi_query, retrieve, rerank, build_prompt = \
        _build_graph_nodes(rag_service, config, reranker_service)

    graph = StateGraph(RAGState)
    graph.add_node("rewrite_query", rewrite_query_node)
    graph.add_node("route_pre_retrieval", route_pre_retrieval)
    graph.add_node("hyde", hyde)
    graph.add_node("multi_query", multi_query)
    graph.add_node("retrieve", retrieve)
    graph.add_node("rerank", rerank)
    graph.add_node("build_prompt", build_prompt)

    _add_common_edges(graph)
    graph.add_edge("build_prompt", END)

    return graph.compile()
