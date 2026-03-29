"""RAGAs evaluation CLI — evaluate KnowHive RAG pipeline quality.

Usage:
    uv run python -m app.eval_ragas dataset.json [--config config.yaml] [--output results.json] [--k 5]

Dataset format (JSON array or JSONL):
    [
      {"question": "What is RAG?", "ground_truth": "Retrieval-Augmented Generation"},
      ...
    ]
"""
import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path
from typing import Any

from app.config import AppConfig, load_config
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


# ── Dataset loading ──────────────────────────────────────────


def load_eval_dataset(path: Path) -> list[dict[str, str]]:
    """Load evaluation dataset from JSON array or JSONL file.

    Each sample must have 'question' and 'ground_truth' fields.
    """
    if not path.exists():
        raise FileNotFoundError(f"Dataset file not found: {path}")

    text = path.read_text(encoding="utf-8").strip()

    # Try JSON array first
    if text.startswith("["):
        samples = json.loads(text)
    else:
        # JSONL: one JSON object per line
        samples = []
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            samples.append(json.loads(line))

    # Validate required fields
    for i, sample in enumerate(samples):
        if "question" not in sample:
            raise ValueError(f"Sample {i} missing required field 'question'")
        if "ground_truth" not in sample:
            raise ValueError(f"Sample {i} missing required field 'ground_truth'")

    return samples


# ── RAG pipeline execution ──────────────────────────────────


async def run_rag_pipeline(
    question: str,
    rag_service: RAGService,
    config: AppConfig,
    k: int = 5,
    reranker_service: Any = None,
) -> dict[str, Any]:
    """Run a single question through the RAG pipeline.

    Supports multi-query expansion and reranking when configured.
    Returns dict with 'answer' (str) and 'contexts' (list[str]).
    """
    from app.config import PreRetrievalStrategy

    # Multi-query: expand queries, retrieve per variant, dedup
    if config.pre_retrieval_strategy == PreRetrievalStrategy.MULTI_QUERY:
        from app.services.multi_query_service import expand_queries

        variants = await expand_queries(question, config)
        seen = set()
        chunks = []
        for q in variants:
            for chunk in rag_service.retrieve(q, k=k):
                key = (chunk.get("metadata", {}).get("file_path", ""), chunk.get("metadata", {}).get("chunk_index", 0))
                if key not in seen:
                    seen.add(key)
                    chunks.append(chunk)
    else:
        chunks = rag_service.retrieve(question, k=k)

    # Reranker: rerank and take top-k
    if config.use_reranker and reranker_service is not None:
        chunks = reranker_service.rerank(question, chunks, top_k=k)

    contexts = [c["content"] for c in chunks]
    messages = rag_service.build_prompt(question, chunks, custom_system_prompt=config.custom_system_prompt)
    answer = await rag_service.call_llm(messages, config)
    return {"answer": answer, "contexts": contexts}


# ── RAGAs sample building ───────────────────────────────────


def build_ragas_samples(
    eval_data: list[dict[str, str]],
    pipeline_results: list[dict[str, Any]],
) -> list:
    """Build RAGAs SingleTurnSample objects from eval data + pipeline results."""
    from ragas import SingleTurnSample

    samples = []
    for data, result in zip(eval_data, pipeline_results):
        sample = SingleTurnSample(
            user_input=data["question"],
            response=result["answer"],
            retrieved_contexts=result["contexts"],
            reference=data["ground_truth"],
        )
        samples.append(sample)
    return samples


# ── Main evaluation ──────────────────────────────────────────


async def run_evaluation(
    dataset_path: Path,
    config_path: Path,
    chroma_path: str,
    output_path: Path | None,
    k: int,
    evaluator_model: str = "gpt-4o-mini",
) -> dict[str, Any]:
    """Run the full RAGAs evaluation pipeline."""
    import warnings

    import chromadb
    from ragas import EvaluationDataset, evaluate

    # Use legacy metric singletons (they are Metric instances accepted by evaluate())
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        from ragas.metrics import (
            answer_relevancy,
            context_precision,
            context_recall,
            faithfulness,
        )

    # Load config and dataset
    config = load_config(config_path)
    eval_data = load_eval_dataset(dataset_path)
    print(f"Loaded {len(eval_data)} evaluation samples")

    # Initialize Chroma + RAG service
    chroma_client = chromadb.PersistentClient(path=chroma_path)
    collection = chroma_client.get_or_create_collection(name="knowhive")
    rag_service = RAGService(collection)

    # Initialize reranker if configured
    reranker_service = None
    if config.use_reranker:
        from app.services.reranker_service import RerankerService

        reranker_service = RerankerService()
        if reranker_service.is_model_downloaded():
            reranker_service.load_model()
            print("Reranker model loaded")
        else:
            print("Reranker model not downloaded, downloading...")
            await reranker_service.download_model()
            reranker_service.load_model()
            print("Reranker model downloaded and loaded")

    # Run each question through the pipeline
    print(f"Running RAG pipeline (strategy={config.pre_retrieval_strategy}, reranker={config.use_reranker})...")
    pipeline_results = []
    for i, sample in enumerate(eval_data):
        result = await run_rag_pipeline(sample["question"], rag_service, config, k=k, reranker_service=reranker_service)
        pipeline_results.append(result)
        print(f"  [{i + 1}/{len(eval_data)}] {sample['question'][:60]}...")

    # Build RAGAs samples
    ragas_samples = build_ragas_samples(eval_data, pipeline_results)
    dataset = EvaluationDataset(samples=ragas_samples)

    # Create OpenAI evaluator LLM and embeddings (separate from the RAG pipeline LLM)
    evaluator_llm = _create_evaluator_llm(evaluator_model)
    evaluator_embeddings = _create_evaluator_embeddings()

    # Run RAGAs evaluation with legacy singleton metrics
    print(f"Running RAGAs evaluation (evaluator: {evaluator_model})...")
    result = evaluate(
        dataset=dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        llm=evaluator_llm,
        embeddings=evaluator_embeddings,
        show_progress=True,
    )

    # Format output — result.scores is List[Dict[str, Any]], one dict per sample
    df = result.to_pandas()
    avg_scores = {col: round(df[col].mean(), 4) for col in df.columns if col not in ("user_input", "response", "retrieved_contexts", "reference")}
    output = {
        "dataset": str(dataset_path),
        "num_samples": len(eval_data),
        "scores": avg_scores,
        "per_sample": df.to_dict(orient="records"),
    }

    if output_path:
        output_path.write_text(json.dumps(output, indent=2, default=str))
        print(f"Results written to {output_path}")
    else:
        print(json.dumps(output, indent=2, default=str))

    return output


def _create_evaluator_embeddings():
    """Create OpenAI embeddings for RAGAS evaluation.

    Uses OPENAI_API_KEY env var. Legacy metrics need embed_query/embed_documents.
    """
    from langchain_openai import OpenAIEmbeddings
    from ragas.embeddings.base import LangchainEmbeddingsWrapper

    return LangchainEmbeddingsWrapper(OpenAIEmbeddings())


def _create_evaluator_llm(model: str = "gpt-4o-mini"):
    """Create OpenAI LLM for RAGAS evaluation. Uses OPENAI_API_KEY env var."""
    from openai import OpenAI
    from ragas.llms import llm_factory

    client = OpenAI()
    return llm_factory(model, client=client, max_tokens=8192)


# ── CLI ──────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="eval_ragas",
        description="Evaluate KnowHive RAG pipeline using RAGAs metrics",
    )
    parser.add_argument(
        "dataset",
        type=Path,
        help="Path to evaluation dataset (JSON array or JSONL)",
    )
    parser.add_argument(
        "--config",
        type=Path,
        default=Path("config.yaml"),
        help="Path to KnowHive config.yaml (default: config.yaml)",
    )
    parser.add_argument(
        "--chroma-path",
        type=str,
        default="./chroma_data",
        help="Path to Chroma persistent storage (default: ./chroma_data)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Output file for results JSON (default: stdout)",
    )
    parser.add_argument(
        "--k",
        type=int,
        default=5,
        help="Number of chunks to retrieve per query (default: 5)",
    )
    parser.add_argument(
        "--evaluator-model",
        type=str,
        default="gpt-4o-mini",
        help="OpenAI model for RAGAS evaluation judge (default: gpt-4o-mini)",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    # Load .env file (for OPENAI_API_KEY used by evaluator)
    from dotenv import load_dotenv
    load_dotenv()

    try:
        asyncio.run(
            run_evaluation(
                dataset_path=args.dataset,
                config_path=args.config,
                chroma_path=args.chroma_path,
                output_path=args.output,
                k=args.k,
                evaluator_model=args.evaluator_model,
            )
        )
    except FileNotFoundError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except ValueError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
