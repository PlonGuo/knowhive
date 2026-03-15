"""LangGraph RAG StateGraph — optional HyDE → retrieve → build_prompt → generate → END."""
from __future__ import annotations

from typing import Any, Literal, TypedDict

from langgraph.graph import END, StateGraph

from app.config import AppConfig
from app.services.hyde_service import generate_hypothetical_doc
from app.services.rag_service import RAGService


class RAGState(TypedDict, total=False):
    """State flowing through the RAG graph."""

    question: str
    k: int
    use_hyde: bool
    hypothetical_doc: str
    chunks: list[dict[str, Any]]
    sources: list[str]
    messages: list[dict[str, str]]
    answer: str


def _should_hyde(state: RAGState) -> Literal["hyde", "retrieve"]:
    """Route to hyde node if use_hyde is True, otherwise skip to retrieve."""
    if state.get("use_hyde", False):
        return "hyde"
    return "retrieve"


def create_rag_graph(rag_service: RAGService, config: AppConfig):
    """Build and compile the RAG StateGraph.

    Nodes: [hyde →] retrieve → build_prompt → generate → END
    HyDE node runs only when use_hyde=True in input state.
    """

    async def hyde(state: RAGState) -> dict:
        hypothetical = await generate_hypothetical_doc(state["question"], config)
        return {"hypothetical_doc": hypothetical}

    async def retrieve(state: RAGState) -> dict:
        k = state.get("k", 5)
        query = state.get("hypothetical_doc", state["question"])
        chunks = rag_service.retrieve(query, k=k)
        sources = rag_service.extract_sources(chunks)
        return {"chunks": chunks, "sources": sources}

    async def build_prompt(state: RAGState) -> dict:
        messages = rag_service.build_prompt(state["question"], state["chunks"])
        return {"messages": messages}

    async def generate(state: RAGState) -> dict:
        answer = await rag_service.call_llm(state["messages"], config)
        return {"answer": answer}

    graph = StateGraph(RAGState)
    graph.add_node("hyde", hyde)
    graph.add_node("retrieve", retrieve)
    graph.add_node("build_prompt", build_prompt)
    graph.add_node("generate", generate)

    graph.add_conditional_edges("__start__", _should_hyde, {"hyde": "hyde", "retrieve": "retrieve"})
    graph.add_edge("hyde", "retrieve")
    graph.add_edge("retrieve", "build_prompt")
    graph.add_edge("build_prompt", "generate")
    graph.add_edge("generate", END)

    return graph.compile()


def create_rag_prep_graph(rag_service: RAGService, config: AppConfig | None = None):
    """Build a prep-only graph: [hyde →] retrieve → build_prompt → END.

    Returns chunks, sources, and messages without calling the LLM.
    Use this for streaming chat where LLM tokens are streamed separately.
    Config is required when use_hyde=True.
    """

    async def hyde(state: RAGState) -> dict:
        hypothetical = await generate_hypothetical_doc(state["question"], config)
        return {"hypothetical_doc": hypothetical}

    async def retrieve(state: RAGState) -> dict:
        k = state.get("k", 5)
        query = state.get("hypothetical_doc", state["question"])
        chunks = rag_service.retrieve(query, k=k)
        sources = rag_service.extract_sources(chunks)
        return {"chunks": chunks, "sources": sources}

    async def build_prompt(state: RAGState) -> dict:
        messages = rag_service.build_prompt(state["question"], state["chunks"])
        return {"messages": messages}

    graph = StateGraph(RAGState)
    graph.add_node("hyde", hyde)
    graph.add_node("retrieve", retrieve)
    graph.add_node("build_prompt", build_prompt)

    graph.add_conditional_edges("__start__", _should_hyde, {"hyde": "hyde", "retrieve": "retrieve"})
    graph.add_edge("hyde", "retrieve")
    graph.add_edge("retrieve", "build_prompt")
    graph.add_edge("build_prompt", END)

    return graph.compile()
