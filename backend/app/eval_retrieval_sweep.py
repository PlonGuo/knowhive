"""Retrieval-only RAGAS sweep against the TS sidecar — context_precision/context_recall
across multiple k values and reranker configurations, skipping answer generation
(context metrics only need question + contexts + ground truth, not the answer).

Used by the reranker k-sweep experiment (learnings/Reranker-K-Sweep.md): the LLM
reranker's answer_relevancy win came with a recall dip at k=5; this measures whether
the dip is a fixed-k crowding artifact and how precision dilutes as k grows.

Run one group (from backend/, with the TS sidecar running on --base):
    uv run python -m app.eval_retrieval_sweep --base http://127.0.0.1:18300 \
        --k 5 --label rerank-on-k5 --output eval_results/retrieval_sweep.json

Repeated runs with the same --output append/overwrite their label in one JSON file.
Toggle the reranker between runs via PUT /config (hot-reloads in the sidecar).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.eval_ragas import (
    load_eval_dataset,
    _create_evaluator_embeddings,
    _create_evaluator_llm,
)
from app.eval_ragas_ts import ts_search


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Retrieval-only RAGAS sweep vs the TS sidecar")
    ap.add_argument("--base", default="http://127.0.0.1:18300")
    ap.add_argument("--dataset", default="eval_dataset.json")
    ap.add_argument("--k", type=int, required=True)
    ap.add_argument("--label", required=True, help="Group name, e.g. rerank-on-k5")
    ap.add_argument("--output", default="eval_results/retrieval_sweep.json")
    ap.add_argument("--evaluator-model", default="gpt-4o-mini")
    args = ap.parse_args(argv)

    from dotenv import load_dotenv

    load_dotenv()  # OPENAI_API_KEY for the RAGAS grader

    eval_data = load_eval_dataset(Path(args.dataset))
    print(f"[{args.label}] {len(eval_data)} questions, k={args.k}, base={args.base}")

    from ragas import EvaluationDataset, SingleTurnSample, evaluate
    from ragas.metrics import context_precision, context_recall

    samples = []
    for i, sample in enumerate(eval_data):
        q = sample["question"]
        contexts = ts_search(args.base, q, args.k)
        samples.append(
            SingleTurnSample(
                user_input=q,
                retrieved_contexts=contexts,
                reference=sample["ground_truth"],
            )
        )
        print(f"  [{i + 1}/{len(eval_data)}] {len(contexts)} contexts | {q[:48]}...")

    print(f"[{args.label}] grading with {args.evaluator_model}...")
    result = evaluate(
        dataset=EvaluationDataset(samples=samples),
        metrics=[context_precision, context_recall],
        llm=_create_evaluator_llm(args.evaluator_model),
        embeddings=_create_evaluator_embeddings(),
        show_progress=True,
    )

    df = result.to_pandas()
    scores = {
        col: round(float(df[col].mean()), 4)
        for col in ("context_precision", "context_recall")
        if col in df.columns
    }
    print(f"[{args.label}] {json.dumps(scores)}")

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    existing = json.loads(out.read_text()) if out.exists() else {"groups": {}}
    existing["groups"][args.label] = {"k": args.k, **scores}
    out.write_text(json.dumps(existing, ensure_ascii=False, indent=2))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
