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


def ts_chat(base: str, question: str, mode: str = "single") -> tuple[str, list[str], list[str]]:
    """Stream /chat and return (answer, tool_contexts, sources).

    - answer: concatenated text deltas.
    - tool_contexts: chunk contents the model actually retrieved via search_knowledge
      tool calls (agentic mode) — empty in single mode.
    - sources: aggregated source file paths from the finish messageMetadata.
    """
    resp = _post(
        f"{base}/chat",
        {
            "mode": mode,
            "messages": [
                {"id": "1", "role": "user", "parts": [{"type": "text", "text": question}]}
            ],
        },
    )
    answer = ""
    tool_contexts: list[str] = []
    sources: list[str] = []
    for raw in resp:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data: ") or line == "data: [DONE]":
            continue
        try:
            evt = json.loads(line[6:])
        except json.JSONDecodeError:
            continue
        etype = evt.get("type")
        if etype == "text-delta" and "delta" in evt:
            answer += evt["delta"]
        elif etype == "tool-output-available":
            for hit in (evt.get("output") or {}).get("results") or []:
                if isinstance(hit, dict) and isinstance(hit.get("content"), str):
                    tool_contexts.append(hit["content"])
        elif etype in ("finish", "message-metadata"):
            meta = evt.get("messageMetadata") or {}
            if isinstance(meta.get("sources"), list):
                sources = meta["sources"]  # later snapshots supersede earlier ones
    return answer, tool_contexts, sources


def source_recall(expected: list[str], actual: list[str]) -> float:
    """Deterministic |expected ∩ actual| / |expected|, matched by file basename
    (the sidecar reports absolute paths; datasets list basenames)."""
    if not expected:
        return 1.0
    actual_names = {Path(a).name for a in actual}
    hit = sum(1 for e in expected if Path(e).name in actual_names)
    return hit / len(expected)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="RAGAS eval against the TS sidecar")
    ap.add_argument("--base", default="http://127.0.0.1:18300")
    ap.add_argument("--dataset", default="eval_dataset.json")
    ap.add_argument("--k", type=int, default=5)
    ap.add_argument("--mode", choices=("single", "agentic"), default="single")
    ap.add_argument("--output", default="eval_results/results_ts_mixed.json")
    ap.add_argument("--evaluator-model", default="gpt-4o-mini")
    ap.add_argument("--limit", type=int, default=0, help="evaluate only the first N samples (0 = all)")
    args = ap.parse_args(argv)

    from dotenv import load_dotenv

    load_dotenv()  # OPENAI_API_KEY for the RAGAS grader

    eval_data = load_eval_dataset(Path(args.dataset))
    if args.limit:
        eval_data = eval_data[: args.limit]
    print(f"Loaded {len(eval_data)} samples; querying TS sidecar at {args.base} (mode={args.mode})")

    pipeline_results = []
    recalls: list[float] = []
    for i, sample in enumerate(eval_data):
        q = sample["question"]
        answer, tool_contexts, sources = ts_chat(args.base, q, args.mode)
        if args.mode == "agentic":
            # Contexts = pre-retrieval (same as /search) + what the model actually
            # pulled via tools — that behavior is exactly what this eval measures.
            contexts = ts_search(args.base, q, args.k) + tool_contexts
        else:
            contexts = ts_search(args.base, q, args.k)
        pipeline_results.append({"answer": answer, "contexts": contexts})

        line = f"  [{i + 1}/{len(eval_data)}] {q[:48]}..."
        if sample.get("expected_sources"):
            r = source_recall(sample["expected_sources"], sources)
            recalls.append(r)
            line += f" source_recall={r:.2f} (tool_ctx={len(tool_contexts)})"
        print(line)

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
    if recalls:
        scores["source_recall"] = round(sum(recalls) / len(recalls), 4)
    print("\n=== TS stack RAGAS scores ===")
    print(json.dumps(scores, ensure_ascii=False, indent=2))

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps(
            {
                "dataset": args.dataset,
                "num_samples": len(eval_data),
                "stack": "ts",
                "mode": args.mode,
                "scores": scores,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
