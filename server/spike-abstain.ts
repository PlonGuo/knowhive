// SPIKE (throwaway): does the cross-encoder score separate answerable from
// unanswerable questions well enough to build a relevance gate on?
//
// Question: retrieval always returns top-k regardless of score, so a question the
// corpus cannot answer still arrives at the model wrapped in <retrieved_context>.
// The cross-encoder already scores all 20 candidates and rerankCrossEncoder throws
// the scores away. If the score distributions separate, the gate is ~free.
//
// This writes scores only — no behavior change. Run from server/:
//   bun spike-abstain.ts
import { mkdirSync, cpSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { openDbAt } from "./src/db.ts";
import { ingestDirectory, type Embedder } from "./src/ingest.ts";
import { hybridSearch } from "./src/store.ts";
import { embed } from "./src/embed.ts";
import { setModelCacheDir, crossEncoderScore } from "./src/crossEncoderModel.ts";
import { RERANK_CANDIDATES } from "./src/rerank.ts";

const REPO = resolve(import.meta.dir, "..");
const WORK = process.env.SPIKE_DIR ?? "/tmp/knowhive-spike-abstain";
// Defaults to the spike's own dir so a fresh run downloads the 571MB model once and
// reuses it; point SPIKE_MODEL_CACHE at an existing <dataDir>/models to skip that.
// Deliberately OUTSIDE WORK, which is wiped on every run — otherwise each run would
// re-download 571MB. Point SPIKE_MODEL_CACHE at an existing <dataDir>/models to reuse one.
const MODEL_CACHE = process.env.SPIKE_MODEL_CACHE ?? `${WORK}-models`;
const OLLAMA = process.env.OLLAMA_BASE ?? "http://localhost:11434";
const EMBED_MODEL = "bge-m3";
const OUT = join(REPO, "backend/eval_results/abstain_spike.json");

const embedder: Embedder = (texts) => embed(texts, { baseUrl: OLLAMA, model: EMBED_MODEL });

async function main() {
  // ---- 1. fresh index over the md eval corpus -----------------------------
  const knowledge = join(WORK, "knowledge");
  if (existsSync(WORK)) rmSync(WORK, { recursive: true, force: true });
  mkdirSync(knowledge, { recursive: true });
  cpSync(join(REPO, "eval-corpus/md"), knowledge, { recursive: true });

  setModelCacheDir(MODEL_CACHE);
  const db = openDbAt(join(WORK, "knowhive.db"));

  console.log("[spike] ingesting eval-corpus/md ...");
  const t0 = performance.now();
  const results = await ingestDirectory(db, knowledge, embedder);
  const chunks = results.reduce((n, r) => n + (r.chunkCount ?? 0), 0);
  console.log(
    `[spike] ${results.length} files / ${chunks} chunks in ${((performance.now() - t0) / 1000).toFixed(1)}s`,
  );

  // ---- 2. load both question sets ----------------------------------------
  type Q = { question: string; bucket: string; why?: string };
  const positives: Q[] = (
    await Bun.file(join(REPO, "backend/eval_dataset_corpus.json")).json()
  ).map((r: { question: string }) => ({ question: r.question, bucket: "positive" }));
  const negatives: Q[] = await Bun.file(
    join(REPO, "backend/eval_dataset_negative.json"),
  ).json();
  const all = [...positives, ...negatives];
  console.log(`[spike] ${positives.length} positive / ${negatives.length} negative`);

  // ---- 3. score every question the way the real pipeline would ------------
  const rows: {
    question: string;
    bucket: string;
    why?: string;
    top1: number;
    top5: number[];
    mean5: number;
    topFile: string;
  }[] = [];

  for (const [i, q] of all.entries()) {
    const [vec] = await embedder([q.question]);
    const candidates = hybridSearch(db, vec!, q.question, RERANK_CANDIDATES);
    if (candidates.length === 0) {
      console.log(`  [${i + 1}/${all.length}] no candidates — skipped`);
      continue;
    }
    const scores = await crossEncoderScore(
      q.question,
      candidates.map((c) => c.content),
    );
    const ranked = candidates
      .map((c, j) => ({ c, s: scores[j]! }))
      .sort((a, b) => b.s - a.s);
    const top5 = ranked.slice(0, 5).map((r) => r.s);
    rows.push({
      question: q.question,
      bucket: q.bucket,
      why: q.why,
      top1: ranked[0]!.s,
      top5,
      mean5: top5.reduce((a, b) => a + b, 0) / top5.length,
      topFile: ranked[0]!.c.file_path.replace(knowledge + "/", ""),
    });
    console.log(
      `  [${i + 1}/${all.length}] ${q.bucket.padEnd(8)} top1=${ranked[0]!.s.toFixed(3).padStart(7)}  ${q.question.slice(0, 34)}`,
    );
  }

  mkdirSync(join(REPO, "backend/eval_results"), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ embedModel: EMBED_MODEL, chunks, rows }, null, 2));
  console.log(`\n[spike] wrote ${OUT}`);

  // ---- 4. separation summary ---------------------------------------------
  const by = (b: string) => rows.filter((r) => r.bucket === b).map((r) => r.top1);
  const stat = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
    return { n: s.length, min: s[0]!, p25: q(0.25), med: q(0.5), p75: q(0.75), max: s[s.length - 1]! };
  };
  console.log("\n=== top-1 cross-encoder score by bucket ===");
  for (const b of ["positive", "near", "far"]) {
    const xs = by(b);
    if (!xs.length) continue;
    const t = stat(xs);
    console.log(
      `${b.padEnd(9)} n=${String(t.n).padStart(2)}  min=${t.min.toFixed(3).padStart(7)}  p25=${t.p25.toFixed(3).padStart(7)}  med=${t.med.toFixed(3).padStart(7)}  p75=${t.p75.toFixed(3).padStart(7)}  max=${t.max.toFixed(3).padStart(7)}`,
    );
  }

  // Threshold sweep: false-abstain on positives vs abstain-rate on negatives.
  const pos = by("positive");
  const neg = rows.filter((r) => r.bucket !== "positive").map((r) => r.top1);
  const negNear = by("near");
  console.log("\n=== threshold sweep (gate: abstain when top1 < t) ===");
  console.log("     t     误拒率(正样本)   拒答率(全部负)   拒答率(near)");
  const lo = Math.min(...pos, ...neg);
  const hi = Math.max(...pos, ...neg);
  for (let i = 0; i <= 20; i++) {
    const t = lo + ((hi - lo) * i) / 20;
    const fa = pos.filter((s) => s < t).length / pos.length;
    const ab = neg.filter((s) => s < t).length / neg.length;
    const abN = negNear.filter((s) => s < t).length / negNear.length;
    console.log(
      `${t.toFixed(3).padStart(7)}   ${(fa * 100).toFixed(0).padStart(11)}%   ${(ab * 100).toFixed(0).padStart(12)}%   ${(abN * 100).toFixed(0).padStart(11)}%`,
    );
  }
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
