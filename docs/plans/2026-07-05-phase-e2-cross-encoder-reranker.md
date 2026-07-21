# Phase E2 — transformers.js Cross-Encoder Reranker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace (behind a config toggle) the slow LLM-as-reranker with an in-process transformers.js cross-encoder (`bge-reranker-v2-m3` ONNX, int8), cutting rerank latency from ~2–8s to ~0.2–0.5s while holding RAGAS quality within noise of the validated baseline.

**Architecture:** Add a second reranker backend that runs the ONNX cross-encoder **in the bun process** via `@huggingface/transformers` (ONNX Runtime, no Ollama, no Python/torch). Keep the existing LLM-as-reranker as a fallback backend, selected by a new `reranker_backend` config field. The real model scorer is **injected** into a pure `rerankCrossEncoder()` (same dependency-injection pattern as the existing `rerankChunks(generate)`), so the sorting/fail-open logic is unit-testable without the 571MB model. Re-validate with the existing RAGAS TS harness before flipping the default.

**Tech Stack:** bun + Hono (server), `@huggingface/transformers` v3 (ONNX Runtime for JS), `onnx-community/bge-reranker-v2-m3-ONNX` (int8, 571MB), Zod (shared schema), `bun test`, RAGAS via `backend/app/eval_ragas_ts.py`.

---

## Context: current wiring (read before starting)

- **Toggle:** `shared/schema.ts:29` — `use_reranker: z.boolean().default(false)`. This plan adds `reranker_backend`.
- **Dispatch:** `server/src/index.ts:182-199` — `retrieve(query, k)`: if `!use_reranker` → `hybridSearch(db, vec, query, k)`; else over-fetch `RERANK_CANDIDATES` (20) → `rerankChunks(query, cands, k, generate, "coverage")`.
- **LLM reranker (keep as-is):** `server/src/rerank.ts` — `buildRerankPrompt` / `parseRanking` / `rerankChunks(generate)`. Generic over `{ content: string }`, injects the `generate` callback, fails open to hybrid order. **Do not delete.**
- **Stub routes (to be wired to real download/status):** `server/src/index.ts:99-106` — `/reranker/status` → `{available:false}`, `/reranker/download` → 503, `/reranker/download-status` → `null`.
- **Frontend (already built, Python-era):** `src/components/settings/SettingsPage.tsx` — already has `RerankerStatus` / `RerankerDownloadStatus` interfaces and polls `/reranker/status` + `/reranker/download-status`. **No frontend work needed beyond confirming shapes match.**
- **RAGAS harness:** `backend/app/eval_ragas_ts.py --base http://127.0.0.1:18300 --dataset eval_dataset.json` hits the sidecar `/search` + `/chat` with whatever config the sidecar is running. Baselines to compare against:
  - `backend/eval_results/ts_mixed_llm_reranker.json` — current LLM reranker (answer_relevancy 0.805, faithfulness 0.696, context_precision 0.829, context_recall 0.660)
  - `backend/eval_results/python_mixed_reranker.json` — Python CrossEncoder (fp32) baseline
- **Tests:** `bun test` (config in `server/package.json`). Existing `server/src/rerank.test.ts` is the pattern to mirror (injects a fake `generate`).

---

## Task 0: Spike — confirm transformers.js can load + score the ONNX model in bun

**Gate:** This de-risks the whole plan. If transformers.js can't run this model in bun, or scores are nonsensical, STOP and reconsider (fp16 variant, `Xenova/bge-reranker-base`, or abandon E2). Throwaway code — do NOT commit.

**Files:**
- Create (throwaway): `server/scratch/spike-cross-encoder.ts`

**Step 1: Add the dependency**

Run: `cd server && bun add @huggingface/transformers`
Expected: added to `server/package.json` dependencies.

**Step 2: Write a spike script that scores 2 obvious pairs**

```ts
// server/scratch/spike-cross-encoder.ts
import { AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers";

const MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";
const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
const model = await AutoModelForSequenceClassification.from_pretrained(MODEL, {
  dtype: "int8", // 571MB quantized variant
});

async function score(query: string, passage: string): Promise<number> {
  const inputs = tokenizer(query, { text_pair: passage, padding: true, truncation: true });
  const { logits } = await model(inputs);
  return logits.data[0] as number; // raw relevance logit
}

// Relevant pair should outscore the irrelevant one.
console.log("relevant:", await score("What is the capital of France?", "Paris is the capital of France."));
console.log("irrelevant:", await score("What is the capital of France?", "Cats are mammals that purr."));
```

**Step 3: Run it**

Run: `cd server && bun run scratch/spike-cross-encoder.ts`
Expected: first run downloads ~571MB (one-time), then prints two numbers where **relevant > irrelevant** by a clear margin. If the exact API differs (transformers.js v3 sometimes prefers the `pipeline("text-classification", ...)` form or a `text_pair` array), adjust here — this is the whole point of the spike.

**Step 4: Record findings, delete the scratch file**

Write the confirmed working API snippet + observed download size + cold/warm latency into a scratch note (paste into the Task 3 subagent prompt later). Then:

Run: `rm server/scratch/spike-cross-encoder.ts`

**No commit** (spike only). If the dependency proved usable, keep it in `package.json`; it gets committed in Task 2.

---

## Task 1: Add `reranker_backend` config field

**Files:**
- Modify: `shared/schema.ts:20-35` (AppConfigSchema)
- Modify (mirror): `backend/app/config.py` (AppConfig) — schema.ts comment says it mirrors this; keep parity so config files load in both stacks
- Test: `shared/schema.test.ts` (create if absent, else add a case)

**Step 1: Write the failing test**

```ts
// shared/schema.test.ts
import { expect, test } from "bun:test";
import { AppConfigSchema } from "./schema.ts";

test("reranker_backend defaults to llm", () => {
  const cfg = AppConfigSchema.parse({});
  expect(cfg.reranker_backend).toBe("llm");
});

test("reranker_backend accepts cross-encoder", () => {
  const cfg = AppConfigSchema.parse({ reranker_backend: "cross-encoder" });
  expect(cfg.reranker_backend).toBe("cross-encoder");
});
```

**Step 2: Run to verify it fails**

Run: `cd shared && bun test schema.test.ts`
Expected: FAIL — `reranker_backend` is undefined.

**Step 3: Add the field**

In `shared/schema.ts`, above `use_reranker`:

```ts
export const RerankerBackend = z.enum(["llm", "cross-encoder"]);
export type RerankerBackend = z.infer<typeof RerankerBackend>;
```

and inside `AppConfigSchema`, next to `use_reranker`:

```ts
  use_reranker: z.boolean().default(false),
  reranker_backend: RerankerBackend.default("llm"), // "llm" = existing LLM-as-reranker; "cross-encoder" = Phase E2 onnx
```

**Step 4: Run to verify it passes**

Run: `cd shared && bun test schema.test.ts`
Expected: PASS.

**Step 5: Mirror in Python config for parity** (so shared config JSON round-trips)

In `backend/app/config.py` add `reranker_backend: str = "llm"` to `AppConfig`. Run `cd backend && uv run pytest tests/ -k config -q` — expected PASS.

**Step 6: Commit**

```bash
git add shared/schema.ts shared/schema.test.ts backend/app/config.py
git commit -m "feat(config): add reranker_backend (llm | cross-encoder) — Phase E2"
```

---

## Task 2: Pure `rerankCrossEncoder()` with injected scorer + fail-open (TDD)

**Design:** Mirror `rerankChunks`. `rerankCrossEncoder` takes a `CrossEncoderScorer = (query, passages) => Promise<number[]>` so tests inject a fake scorer. Sort by score desc, take top-k, fail open to input order on any throw.

**Files:**
- Create: `server/src/crossEncoder.ts`
- Test: `server/src/crossEncoder.test.ts`

**Step 1: Write the failing tests**

```ts
// server/src/crossEncoder.test.ts
import { expect, test } from "bun:test";
import { rerankCrossEncoder } from "./crossEncoder.ts";

const chunks = [
  { content: "a" }, { content: "b" }, { content: "c" },
];

test("sorts by score descending and takes top-k", async () => {
  const score = async () => [0.1, 0.9, 0.5]; // b > c > a
  const out = await rerankCrossEncoder("q", chunks, 2, score);
  expect(out.map((c) => c.content)).toEqual(["b", "c"]);
});

test("fails open to input order when scorer throws", async () => {
  const score = async () => { throw new Error("model down"); };
  const out = await rerankCrossEncoder("q", chunks, 2, score);
  expect(out.map((c) => c.content)).toEqual(["a", "b"]);
});

test("handles <=1 chunk without scoring", async () => {
  const score = async () => { throw new Error("should not be called"); };
  const out = await rerankCrossEncoder("q", [{ content: "x" }], 5, score);
  expect(out.map((c) => c.content)).toEqual(["x"]);
});
```

**Step 2: Run to verify they fail**

Run: `cd server && bun test src/crossEncoder.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the minimal implementation**

```ts
// server/src/crossEncoder.ts
// Cross-encoder reranker (Phase E2): scores each (query, passage) pair with an ONNX
// cross-encoder and sorts by relevance. The scorer is injected so this pure logic is
// testable without the 571MB model. Fails open to input order on any error.

export type CrossEncoderScorer = (query: string, passages: string[]) => Promise<number[]>;

export async function rerankCrossEncoder<T extends { content: string }>(
  query: string,
  chunks: T[],
  k: number,
  score: CrossEncoderScorer,
): Promise<T[]> {
  if (chunks.length <= 1) return chunks.slice(0, k);
  try {
    const scores = await score(query, chunks.map((c) => c.content));
    if (scores.length !== chunks.length) return chunks.slice(0, k);
    return chunks
      .map((c, i) => ({ c, s: scores[i]! }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.c);
  } catch (err) {
    console.error("[crossEncoder] rerank failed, falling back to hybrid order:", err);
    return chunks.slice(0, k);
  }
}
```

**Step 4: Run to verify they pass**

Run: `cd server && bun test src/crossEncoder.test.ts`
Expected: PASS (3 tests).

**Step 5: Commit**

```bash
git add server/src/crossEncoder.ts server/src/crossEncoder.test.ts server/package.json server/bun.lockb
git commit -m "feat(server): pure cross-encoder rerank logic + injected scorer — Phase E2"
```

---

## Task 3: Wire the real transformers.js scorer (lazy singleton) + dispatch in retrieve()

**Design:** A lazy-loaded module-level singleton loads tokenizer+model once (first rerank pays the load cost), then `crossEncoderScore(query, passages)` tokenizes each pair and returns logits. `retrieve()` dispatches on `config.reranker_backend`. Not unit-tested (real model) — validated in Task 5.

**Files:**
- Create: `server/src/crossEncoderModel.ts` (real transformers.js scorer, uses the API confirmed in Task 0)
- Modify: `server/src/index.ts:182-199` (`retrieve` dispatch)

**Step 1: Implement the real scorer** (use the exact API confirmed in the Task 0 spike)

```ts
// server/src/crossEncoderModel.ts
import { AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers";
import type { CrossEncoderScorer } from "./crossEncoder.ts";

const MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";

let loaded: Promise<{ tokenizer: any; model: any }> | null = null;
function load() {
  if (!loaded) {
    loaded = (async () => ({
      tokenizer: await AutoTokenizer.from_pretrained(MODEL),
      model: await AutoModelForSequenceClassification.from_pretrained(MODEL, { dtype: "int8" }),
    }))();
  }
  return loaded;
}

export const crossEncoderScore: CrossEncoderScorer = async (query, passages) => {
  const { tokenizer, model } = await load();
  const scores: number[] = [];
  for (const p of passages) {
    const inputs = tokenizer(query, { text_pair: p, padding: true, truncation: true });
    const { logits } = await model(inputs);
    scores.push(logits.data[0] as number);
  }
  return scores;
};

export function isCrossEncoderLoaded(): boolean {
  return loaded !== null;
}
```

**Step 2: Dispatch in `retrieve()`** — replace `server/src/index.ts:182-199`:

```ts
const retrieve = async (query: string, k: number) => {
  const [queryVector] = await embedder([query]);
  if (!config.use_reranker) return hybridSearch(db, queryVector!, query, k);

  const candidates = hybridSearch(db, queryVector!, query, RERANK_CANDIDATES);

  if (config.reranker_backend === "cross-encoder") {
    return rerankCrossEncoder(query, candidates, k, crossEncoderScore);
  }
  return rerankChunks(
    query,
    candidates,
    k,
    async (prompt) => {
      const { text } = await generateText({ model: chatModel(), prompt, temperature: 0 });
      return text;
    },
    process.env.KNOWHIVE_RERANK_STYLE === "relevance" ? "relevance" : "coverage",
  );
};
```

Add imports at top of `index.ts`:
```ts
import { rerankCrossEncoder } from "./crossEncoder.ts";
import { crossEncoderScore, isCrossEncoderLoaded } from "./crossEncoderModel.ts";
```

**Step 3: Smoke test manually**

Run: `cd server && KNOWHIVE_DATA_DIR=/tmp/knowhive-e2 bun run src/index.ts` (or the project's normal start), set config `use_reranker=true`, `reranker_backend=cross-encoder`, then `curl -s localhost:18300/search -d '{"query":"...","k":5}'`.
Expected: first call downloads model + is slow; returns 5 hits; second call is fast (~0.2–0.5s). Verify hits look sensibly ordered.

**Step 4: Run the full server test suite**

Run: `cd server && bun test`
Expected: PASS (existing suite green; no regression from dispatch change).

**Step 5: Commit**

```bash
git add server/src/crossEncoderModel.ts server/src/index.ts
git commit -m "feat(server): wire transformers.js cross-encoder into retrieve() dispatch — Phase E2"
```

---

## Task 4: Wire `/reranker/*` routes to real download + status

**Design:** transformers.js downloads to its cache on first `from_pretrained`. Expose real status so the existing Settings UI stops showing "not available". Keep it honest — report `downloaded`/`loaded` from actual state.

**Files:**
- Modify: `server/src/index.ts:99-106` (the three stub routes)
- Confirm shapes against: `src/components/settings/SettingsPage.tsx:29-40` (`RerankerStatus`, `RerankerDownloadStatus`)

**Step 1: Check the frontend-expected shapes**

Read `src/components/settings/SettingsPage.tsx:29-40`. Match `RerankerStatus` fields exactly (`available`, `model`, `size_mb`, `downloaded`, `loaded`) so no frontend change is needed.

**Step 2: Replace the stub routes**

```ts
app.get("/reranker/status", (c) =>
  c.json({
    available: true,
    model: "onnx-community/bge-reranker-v2-m3-ONNX (int8)",
    size_mb: 571,
    downloaded: isCrossEncoderLoaded(), // becomes true after first load; refine if a cache-probe is needed
    loaded: isCrossEncoderLoaded(),
  }),
);
app.post("/reranker/download", async (c) => {
  await crossEncoderScore("warmup", ["warmup"]); // triggers download + load
  return c.json({ status: "complete" });
});
app.get("/reranker/download-status", (c) =>
  c.json({ status: isCrossEncoderLoaded() ? "complete" : null }),
);
```

**Step 3: Smoke test the endpoints**

Run: `curl -s localhost:18300/reranker/status` before/after `curl -X POST localhost:18300/reranker/download`.
Expected: `loaded` flips `false → true`; download endpoint returns after model warms up.

**Step 4: Confirm Settings UI**

Start the app, open Settings → reranker section shows the model as available/downloadable (no code change expected). If a field mismatch surfaces, fix the route JSON (not the frontend) to match `SettingsPage.tsx`.

**Step 5: Commit**

```bash
git add server/src/index.ts
git commit -m "feat(server): wire /reranker status+download to transformers.js model — Phase E2"
```

---

## Task 5: RAGAS re-eval — int8 vs baseline, decision gate for fp16

**This is the validation gate.** Same discipline as the LLM-as-reranker validation: int8 quantization may cost quality; prove it doesn't before flipping the default.

**Files:**
- Produce: `backend/eval_results/ts_mixed_cross_encoder_int8.json`
- Update: `learnings/decisions/Stack-Migration-and-RAGAS-Validation.md` (add a Phase E2 section)

**Step 1: Run the sidecar with cross-encoder config**

Start sidecar with `use_reranker=true`, `reranker_backend=cross-encoder`. Warm the model once (`POST /reranker/download`).

**Step 2: Run the RAGAS TS harness**

Run:
```bash
cd backend && uv run python -m app.eval_ragas_ts \
  --base http://127.0.0.1:18300 --dataset eval_dataset.json \
  > eval_results/ts_mixed_cross_encoder_int8.json
```
Expected: four metrics (faithfulness, answer_relevancy, context_precision, context_recall).

**Step 3: Compare against baselines**

Compare `ts_mixed_cross_encoder_int8.json` to:
- `ts_mixed_llm_reranker.json` (0.696 / 0.805 / 0.829 / 0.660)
- `python_mixed_reranker.json` (fp32 CrossEncoder)

**Decision rule:**
- All four within ±0.03 of the LLM-reranker baseline → **int8 wins** (571MB, fast). Proceed to Step 5.
- Any metric drops >0.03 → run fp16: reload with `dtype: "fp16"` in `crossEncoderModel.ts`, re-run this task producing `ts_mixed_cross_encoder_fp16.json`. If fp16 recovers quality, keep fp16 (1.14GB) and note the size/quality tradeoff. If even fp16 regresses, **do not flip the default** — keep `reranker_backend` default `llm`, record the finding, stop.

**Step 4: Record measured latency**

Note cold-load and warm per-query rerank latency (from Task 3 smoke test) alongside the RAGAS numbers — the whole point of E2 is the latency win; quantify it.

**Step 5: Write up the result**

Append a "Phase E2 复评" section to `learnings/decisions/Stack-Migration-and-RAGAS-Validation.md`: model + dtype chosen, RAGAS deltas vs LLM reranker + Python fp32, measured latency, and the default decision.

**Step 6: Commit**

```bash
git add backend/eval_results/ts_mixed_cross_encoder_*.json learnings/decisions/Stack-Migration-and-RAGAS-Validation.md
git commit -m "docs: RAGAS Phase E2 re-eval — cross-encoder (int8/fp16) vs LLM reranker baseline"
```

---

## Task 6: Flip default (only if Task 5 passed) + docs

**Files:**
- Modify: `shared/schema.ts` (maybe flip `reranker_backend` default) + `backend/app/config.py`
- Modify: `HANDOFF.md`

**Step 1: Decide the default**

If Task 5 confirmed parity: change `reranker_backend` default to `"cross-encoder"` in both `shared/schema.ts` and `backend/app/config.py`. If it did not pass, leave default `"llm"` and document why. (Note: `use_reranker` itself stays `false` by default — this only changes *which* backend runs when reranking is enabled.)

**Step 2: Update HANDOFF**

Add a Phase E2 完成 line mirroring the E1 entry: model, dtype, RAGAS deltas, latency, default decision. Move the "transformers.js ONNX spike" item from roadmap to done.

**Step 3: Full test + commit**

Run: `cd server && bun test` and `cd shared && bun test` — expected PASS.
```bash
git add shared/schema.ts backend/app/config.py HANDOFF.md
git commit -m "feat: default reranker_backend=cross-encoder + Phase E2 handoff"
```

---

## Risks & open questions

1. **transformers.js reranker API in bun (Task 0 gate).** The exact call (`AutoModelForSequenceClassification` vs `pipeline("text-classification")`, `text_pair` shape, `dtype` name) must be confirmed by the spike. Everything downstream assumes Task 0 nailed it.
2. **int8 quality loss.** Real risk; Task 5 is the gate. fp16 (1.14GB) is the fallback, fp32 (2.27GB) the last resort.
3. **Cold-load latency & bun startup.** First rerank downloads 571MB and loads the model (multi-second). Acceptable for desktop; the warm path is what matters. Consider a background warmup on startup only if UX demands it (out of scope here).
4. **Model cache location & offline.** transformers.js caches under its default dir; confirm it persists across app restarts and respects any offline/proxy constraints the app already has for Ollama. (Investigate if the app must work fully offline after first download.)
5. **`downloaded` status fidelity.** Task 4 approximates `downloaded` with `isCrossEncoderLoaded()`. If the Settings UX needs true "downloaded-but-not-loaded" state, add a cache-dir probe — deferred unless needed.
