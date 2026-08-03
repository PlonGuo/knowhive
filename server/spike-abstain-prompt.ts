// SPIKE 2 (throwaway): how often does the model abstain on its own, with NO gate?
//
// The relevance gate was built on an assumption that was never measured: that the
// system prompt's "if the context doesn't contain relevant information, say so
// honestly" is unreliable. This measures it. The answer decides what to fix next --
// a weak prompt is a prompt problem, not a missing-signal problem.
//
// Run from server/ with a sidecar on --base and KNOWHIVE_RELEVANCE_FLOOR=off:
//   bun spike-abstain-prompt.ts
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO = resolve(import.meta.dir, "..");
const BASE = process.env.SPIKE_BASE ?? "http://127.0.0.1:18310";
const OUT = join(REPO, process.env.SPIKE_OUT ?? "backend/eval_results/abstain_prompt_spike.json");

// Deliberately broad: over-matching inflates the model's score, so a low number
// measured with a generous detector is strong evidence the prompt is weak.
const ABSTAIN = [
  /没有|未找到|找不到|不包含|无法找到|无相关|不知道|没提到|未提及|没有相关/,
  /\b(no|not|cannot|can't|don't|doesn't|unable)\b[^.]{0,40}\b(relevant|information|context|mention|contain|find|available|provided|notes?|documents?)\b/i,
  /\bnot (in|found|present|available|covered)\b/i,
];
const abstained = (t: string) => {
  const m = t.match(/ANSWERABLE:\s*(yes|no)/i);
  if (m) return m[1]!.toLowerCase() === "no";   // structured verdict wins when present
  return ABSTAIN.some((r) => r.test(t));
};

async function ask(question: string): Promise<string> {
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: question }] }] }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  // UI Message Stream: collect text deltas.
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "text-delta" && typeof ev.delta === "string") out += ev.delta;
      } catch {
        /* non-JSON keepalive */
      }
    }
  }
  return out;
}

const DATASET = process.env.SPIKE_DATASET ?? "backend/eval_dataset_negative.json";
// Positive sets carry {question, ground_truth}; negative sets carry {question, bucket}.
const raw: Record<string, string>[] = await Bun.file(join(REPO, DATASET)).json();
const negatives = raw.map((r) => ({ question: r.question!, bucket: r.bucket ?? "answerable" }));

const rows: { question: string; bucket: string; answer: string; abstained: boolean }[] = [];
for (const [i, q] of negatives.entries()) {
  const answer = await ask(q.question).catch((e) => `<<ERROR: ${e.message}>>`);
  const ab = abstained(answer);
  rows.push({ question: q.question, bucket: q.bucket, answer, abstained: ab });
  console.log(
    `[${i + 1}/${negatives.length}] ${ab ? "拒答 ✓" : "编了 ✗"} ${q.bucket.padEnd(5)} ${q.question.slice(0, 30)}`,
  );
  console.log(`      → ${answer.slice(0, 110).replace(/\n/g, " ")}`);
}

writeFileSync(OUT, JSON.stringify({ base: BASE, rows }, null, 2));
const n = rows.length;
const ok = rows.filter((r) => r.abstained).length;
const near = rows.filter((r) => r.bucket === "near");
const far = rows.filter((r) => r.bucket === "far");
console.log(`\n=== 无闸时，模型自己拒答的比例 ===`);
console.log(`全部  ${ok}/${n} = ${((ok / n) * 100).toFixed(0)}%`);
console.log(
  `near  ${near.filter((r) => r.abstained).length}/${near.length}   far  ${far.filter((r) => r.abstained).length}/${far.length}`,
);
console.log(`\n(检测器故意放宽 — 宽松匹配下仍然低，才是 prompt 弱的强证据)`);
console.log(`wrote ${OUT}`);
