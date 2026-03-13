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
) -> dict[str, Any]:
    """Run a single question through the RAG pipeline.

    Returns dict with 'answer' (str) and 'contexts' (list[str]).
    """
    chunks = rag_service.retrieve(question, k=k)
    contexts = [c["content"] for c in chunks]
    messages = rag_service.build_prompt(question, chunks)
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
) -> dict[str, Any]:
    """Run the full RAGAs evaluation pipeline."""
    from ragas import EvaluationDataset, evaluate
    from ragas.llms import llm_factory
    from ragas.metrics.collections import (
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
    import chromadb

    chroma_client = chromadb.PersistentClient(path=chroma_path)
    collection = chroma_client.get_or_create_collection(name="knowhive")
    rag_service = RAGService(collection)

    # Run each question through the pipeline
    print("Running RAG pipeline...")
    pipeline_results = []
    for i, sample in enumerate(eval_data):
        result = await run_rag_pipeline(sample["question"], rag_service, config, k=k)
        pipeline_results.append(result)
        print(f"  [{i + 1}/{len(eval_data)}] {sample['question'][:60]}...")

    # Build RAGAs samples
    ragas_samples = build_ragas_samples(eval_data, pipeline_results)
    dataset = EvaluationDataset(samples=ragas_samples)

    # Create evaluator LLM (uses the same LLM from config as the judge)
    evaluator_llm = _create_evaluator_llm(config)

    # Run RAGAs evaluation
    print("Running RAGAs evaluation...")
    metrics = [
        faithfulness.Faithfulness(),
        answer_relevancy.AnswerRelevancy(),
        context_precision.LLMContextPrecisionWithReference(),
        context_recall.LLMContextRecall(),
    ]
    result = evaluate(
        dataset=dataset,
        metrics=metrics,
        llm=evaluator_llm,
        show_progress=True,
    )

    # Format output
    output = {
        "dataset": str(dataset_path),
        "num_samples": len(eval_data),
        "scores": {k: round(v, 4) for k, v in result.scores.items()},
        "per_sample": result.to_pandas().to_dict(orient="records"),
    }

    if output_path:
        output_path.write_text(json.dumps(output, indent=2, default=str))
        print(f"Results written to {output_path}")
    else:
        print(json.dumps(output, indent=2, default=str))

    return output


def _create_evaluator_llm(config: AppConfig):
    """Create a RAGAs-compatible LLM wrapper from KnowHive config."""
    from ragas.llms import llm_factory

    if config.llm_provider == "anthropic":
        from anthropic import Anthropic

        client = Anthropic(
            api_key=config.api_key or "",
            base_url=config.base_url if config.base_url != "https://api.anthropic.com" else None,
        )
        return llm_factory(config.model_name, provider="anthropic", client=client)
    elif config.llm_provider == "ollama":
        from openai import OpenAI

        client = OpenAI(
            api_key="ollama",
            base_url=f"{config.base_url.rstrip('/')}/v1",
        )
        return llm_factory(config.model_name, client=client)
    else:
        # OpenAI-compatible
        from openai import OpenAI

        client = OpenAI(
            api_key=config.api_key or "no-key",
            base_url=config.base_url,
        )
        return llm_factory(config.model_name, client=client)


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
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    try:
        asyncio.run(
            run_evaluation(
                dataset_path=args.dataset,
                config_path=args.config,
                chroma_path=args.chroma_path,
                output_path=args.output,
                k=args.k,
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
