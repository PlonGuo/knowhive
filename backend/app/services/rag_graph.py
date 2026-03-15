"""LangGraph RAG StateGraph — retrieve → build_prompt → generate → END."""
from __future__ import annotations

from typing import Any, TypedDict

from langgraph.graph import END, StateGraph

from app.config import AppConfig
from app.services.rag_service import RAGService


class RAGState(TypedDict, total=False):
    """State flowing through the RAG graph."""

    question: str
    k: int
    chunks: list[dict[str, Any]]
    sources: list[str]
    messages: list[dict[str, str]]
    answer: str


def create_rag_graph(rag_service: RAGService, config: AppConfig):
    """Build and compile the RAG StateGraph.

    Nodes: retrieve → build_prompt → generate → END
    """

    async def retrieve(state: RAGState) -> dict:
        k = state.get("k", 5)
        chunks = rag_service.retrieve(state["question"], k=k)
        sources = rag_service.extract_sources(chunks)
        return {"chunks": chunks, "sources": sources}

    async def build_prompt(state: RAGState) -> dict:
        messages = rag_service.build_prompt(state["question"], state["chunks"])
        return {"messages": messages}

    async def generate(state: RAGState) -> dict:
        answer = await rag_service.call_llm(state["messages"], config)
        return {"answer": answer}

    graph = StateGraph(RAGState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("build_prompt", build_prompt)
    graph.add_node("generate", generate)

    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "build_prompt")
    graph.add_edge("build_prompt", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


def create_rag_prep_graph(rag_service: RAGService):
    """Build a prep-only graph: retrieve → build_prompt → END.

    Returns chunks, sources, and messages without calling the LLM.
    Use this for streaming chat where LLM tokens are streamed separately.
    """

    async def retrieve(state: RAGState) -> dict:
        k = state.get("k", 5)
        chunks = rag_service.retrieve(state["question"], k=k)
        sources = rag_service.extract_sources(chunks)
        return {"chunks": chunks, "sources": sources}

    async def build_prompt(state: RAGState) -> dict:
        messages = rag_service.build_prompt(state["question"], state["chunks"])
        return {"messages": messages}

    graph = StateGraph(RAGState)
    graph.add_node("retrieve", retrieve)
    graph.add_node("build_prompt", build_prompt)

    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "build_prompt")
    graph.add_edge("build_prompt", END)

    return graph.compile()
