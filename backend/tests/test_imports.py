"""
Task 5 + Task 18 verification: backend scaffold and RAG imports are available.
"""
import importlib


def test_fastapi_importable():
    fastapi = importlib.import_module("fastapi")
    assert fastapi.__version__, "fastapi should have a version"


def test_uvicorn_importable():
    uvicorn = importlib.import_module("uvicorn")
    assert uvicorn.__version__, "uvicorn should have a version"


def test_pydantic_importable():
    pydantic = importlib.import_module("pydantic")
    assert pydantic.__version__, "pydantic should have a version"


# Task 18: RAG dependencies


def test_langchain_core_importable():
    mod = importlib.import_module("langchain_core")
    assert mod, "langchain_core should be importable"


def test_langchain_community_importable():
    mod = importlib.import_module("langchain_community")
    assert mod, "langchain_community should be importable"


def test_langchain_text_splitters_importable():
    mod = importlib.import_module("langchain_text_splitters")
    assert mod, "langchain_text_splitters should be importable"


def test_chromadb_importable():
    mod = importlib.import_module("chromadb")
    assert mod.__version__, "chromadb should have a version"


def test_sentence_transformers_importable():
    mod = importlib.import_module("sentence_transformers")
    assert mod.__version__, "sentence_transformers should have a version"


def test_aiosqlite_importable():
    mod = importlib.import_module("aiosqlite")
    assert mod, "aiosqlite should be importable"


def test_pyyaml_importable():
    mod = importlib.import_module("yaml")
    assert mod, "pyyaml should be importable"


# Task 51: RAGAs + Langfuse dev dependencies


def test_ragas_importable():
    mod = importlib.import_module("ragas")
    assert mod.__version__, "ragas should have a version"


def test_langfuse_importable():
    mod = importlib.import_module("langfuse")
    assert mod, "langfuse should be importable"


def test_ragas_metrics_importable():
    mod = importlib.import_module("ragas.metrics")
    assert mod, "ragas.metrics should be importable"


# Task 89: LangChain provider + LangGraph dependencies


def test_langchain_ollama_importable():
    mod = importlib.import_module("langchain_ollama")
    assert mod, "langchain_ollama should be importable"


def test_langchain_openai_importable():
    mod = importlib.import_module("langchain_openai")
    assert mod, "langchain_openai should be importable"


def test_langchain_anthropic_importable():
    mod = importlib.import_module("langchain_anthropic")
    assert mod, "langchain_anthropic should be importable"


def test_langgraph_importable():
    from langgraph.graph import StateGraph
    assert StateGraph, "langgraph StateGraph should be importable"
