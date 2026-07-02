"""RAGAS evaluation against the TS/bun sidecar — to compare the rewritten stack's
retrieval + generation quality against the Python baseline (eval_results/*.json).

Reuses the same dataset, the same RAGAS metrics, and the same gpt-4o-mini grader as
app.eval_ragas, but sources (answer, contexts) from the TS sidecar's HTTP endpoints
instead of the in-process Python RAG service.

Run (from backend/, with the TS sidecar running on --base):
    uv run python -m app.eval_ragas_ts --base http://127.0.0.1:18300 --dataset eval_dataset.json
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

from app.eval_ragas import (
    build_ragas_samples,
    load_eval_dataset,
    _create_evaluator_embeddings,
    _create_evaluator_llm,
)


def _post(url: str, payload: dict):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers={"content-type": "application/json"})
    return urllib.request.urlopen(req, timeout=180)


def ts_search(base: str, query: str, k: int) -> list[str]:
    """Retrieve contexts via the TS hybrid /search endpoint."""
    resp = _post(f"{base}/search", {"query": query, "k": k})
    hits = json.loads(resp.read()).get("hits", [])
    return [h["content"] for h in hits]


def ts_chat(base: str, question: str) -> str:
    """Get the streamed answer via /chat, concatenating UI-message text deltas."""
    resp = _post(
        f"{base}/chat",
        {"messages": [{"id": "1", "role": "user", "parts": [{"type": "text", "text": question}]}]},
    )
    answer = ""
    for raw in resp:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        try:
            evt = json.loads(line[6:])
        except json.JSONDecodeError:
            continue
        if evt.get("type") == "text-delta" and "delta" in evt:
            answer += evt["delta"]
    return answer


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="RAGAS eval against the TS sidecar")
    ap.add_argument("--base", default="http://127.0.0.1:18300")
    ap.add_argument("--dataset", default="eval_dataset.json")
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--output", default="eval_results/results_ts_mixed.json")
    ap.add_argument("--evaluator-model", default="gpt-4o-mini")
    args = ap.parse_args(argv)

    from dotenv import load_dotenv

    load_dotenv()  # OPENAI_API_KEY for the RAGAS grader

    eval_data = load_eval_dataset(Path(args.dataset))
    print(f"Loaded {len(eval_data)} samples; querying TS sidecar at {args.base}")

    pipeline_results = []
    for i, sample in enumerate(eval_data):
        q = sample["question"]
        contexts = ts_search(args.base, q, args.k)
        answer = ts_chat(args.base, q)
        pipeline_results.append({"answer": answer, "contexts": contexts})
        print(f"  [{i + 1}/{len(eval_data)}] {q[:56]}...")

    samples = build_ragas_samples(eval_data, pipeline_results)

    from ragas import EvaluationDataset, evaluate
    from ragas.metrics import (
        answer_relevancy,
        context_precision,
        context_recall,
        faithfulness,
    )

    dataset = EvaluationDataset(samples=samples)
    print(f"Running RAGAS (grader: {args.evaluator_model})...")
    result = evaluate(
        dataset=dataset,
        metrics=[faithfulness, answer_relevancy, context_precision, context_recall],
        llm=_create_evaluator_llm(args.evaluator_model),
        embeddings=_create_evaluator_embeddings(),
        show_progress=True,
    )

    df = result.to_pandas()
    scores = {
        col: round(float(df[col].mean()), 4)
        for col in ("faithfulness", "answer_relevancy", "context_precision", "context_recall")
        if col in df.columns
    }
    print("\n=== TS stack RAGAS scores ===")
    print(json.dumps(scores, ensure_ascii=False, indent=2))

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {"dataset": args.dataset, "num_samples": len(eval_data), "stack": "ts", "scores": scores},
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
