// Real transformers.js cross-encoder scorer (Phase E2). Lazy singleton: the first
// rerank (or POST /reranker/download) pays the download+load cost, everything after
// scores in ~10-20ms/pair (spike-verified in bun; int8 ONNX, 571MB).
// Not unit-tested — the pure sorting logic lives in crossEncoder.ts; this module is
// validated by the Task 5 RAGAS run.
import { AutoTokenizer, AutoModelForSequenceClassification, env } from "@huggingface/transformers";
import type { CrossEncoderScorer } from "./crossEncoder.ts";

const MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";
// int8 passed the Phase E2 RAGAS quality gate (zero drops vs the LLM baseline).
const DTYPE = "int8";

// Pin the truncation length. Without it transformers.js falls back to the tokenizer's
// model_max_length (8192 for this XLM-R model), which bounds nothing in practice.
// Children are <=CHILD_SIZE (1000 chars), so 2048 tokens clears query+passage even
// for all-CJK text where roughly one token == one character.
const MAX_LENGTH = 2048;

// SCORING IS DELIBERATELY ONE PAIR PER FORWARD PASS. Batching looks like the obvious
// win here (rerank is 860ms / 46% of TTFT, learnings/evals/Latency-Waterfall.md) and
// it was implemented and measured on 2026-08-02. It lost on both axes:
//
//   throughput, 20 realistic ~1000-char chunks:
//     batch=1 2223ms | batch=4 3227ms (0.69x) | batch=8 3214ms (0.69x) | batch=20 3041ms (0.73x)
//   correctness, one passage scored in different company:
//     alone 1.8933 | batched with a short passage 1.8604 | batched with a long one 1.5851
//
// Throughput: onnxruntime-node already saturates the cores with intra-op parallelism
// inside a single inference, so a batch adds no usable parallelism — only padding waste.
// Correctness: right-padding shifts the score by up to ~0.3, which is enough to reorder
// near-ties, so a chunk's rank would depend on which candidates it happened to be
// grouped with. Non-deterministic ranking is a worse bug than a slow reranker.
// Full write-up: learnings/career/09-工程改进实战记录.md

// transformers.js defaults its cache to a relative path — read-only inside a packaged
// .app (and inside bunfs, see learnings/decisions/Bun-Compile-Native-Deps-Spike.md). index.ts
// points this at <dataDir>/models on startup, before the first load().
let modelCacheDir: string | null = null;

export function setModelCacheDir(dir: string): void {
  modelCacheDir = dir;
}

export function getModelCacheDir(): string | null {
  return modelCacheDir;
}

let loaded: Promise<{
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
}> | null = null;
let ready = false;
let loadError: string | null = null;

function load() {
  if (!loaded) {
    loaded = (async () => {
      if (modelCacheDir) env.cacheDir = modelCacheDir;
      const t0 = performance.now();
      try {
        const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
        const model = await AutoModelForSequenceClassification.from_pretrained(MODEL, {
          dtype: DTYPE,
        });
        ready = true;
        loadError = null;
        console.log(
          `[crossEncoder] ${MODEL} (${DTYPE}) loaded in ${(performance.now() - t0).toFixed(0)}ms`,
        );
        return { tokenizer, model };
      } catch (err) {
        // Allow a retry (e.g. interrupted first download) instead of caching the failure.
        loadError = (err as Error).message;
        loaded = null;
        throw err;
      }
    })();
  }
  return loaded;
}

/** Kick off download+load without awaiting (first download can take minutes —
 * far beyond any request timeout). Progress is observed via downloadStatus(). */
export function warmup(): void {
  load().catch((err) => console.error("[crossEncoder] warmup failed:", err));
}

export type CrossEncoderDownloadStatus = "downloading" | "complete" | "error" | null;

export function downloadStatus(): { status: CrossEncoderDownloadStatus; error?: string } {
  if (ready) return { status: "complete" };
  if (loadError) return { status: "error", error: loadError };
  if (loaded) return { status: "downloading" };
  return { status: null };
}

export const crossEncoderScore: CrossEncoderScorer = async (query, passages) => {
  const { tokenizer, model } = await load();
  const scores: number[] = [];
  for (const passage of passages) {
    const inputs = tokenizer(query, {
      text_pair: passage,
      padding: true,
      truncation: true,
      max_length: MAX_LENGTH,
    });
    const { logits } = await model(inputs);
    scores.push(logits.data[0] as number);
  }
  return scores;
};

/** True only once the model is actually usable (not merely "load started"). */
export function isCrossEncoderLoaded(): boolean {
  return ready;
}
