// What does a single answer cost, and what does agentic mode multiply it by?
//
// The agentic gate write-up (learnings/evals/Agentic-vs-SingleShot.md) has quality and
// latency numbers but no cost number, so "agentic is expensive" was an assertion. This
// measures it: same questions, same retrieval config, only chat_mode differs.
//
// Reads usage straight off the /chat stream rather than from Langfuse, so the numbers
// stand on their own and the trace becomes a cross-check instead of the source.
//
//   bun run spike-cost.ts --port 18290 [--runs 1] [--out ../backend/eval_results/cost.json]
//
// Retrieval must be identical across arms or the comparison is meaningless — run with
// the cross-encoder reranker, never the LLM one, whose extra generateText call would
// land in the totals and be attributed to chat_mode.

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};

const port = arg("port", "18290")!;
const runs = Number(arg("runs", "1"));
const out = arg("out");
const base = `http://127.0.0.1:${port}`;

/** USD per token. Registered in Langfuse too, so the two sources must agree. */
const PRICES: Record<string, { input: number; output: number }> = {
  "deepseek-v4-pro": { input: 0.435e-6, output: 0.87e-6 },
  "deepseek-v4-flash": { input: 0.14e-6, output: 0.28e-6 },
  // Local inference has no per-token bill. Not "free" — electricity and wall-clock are
  // real — but there is nothing to price per token.
  "llama3.2": { input: 0, output: 0 },
};

// Half single-hop, half spanning two documents: the multi-doc ones are where the agent
// has a reason to call a tool, and therefore where the cost gap should appear at all.
const QUESTIONS = [
  "What are the three rules of ownership in Rust?",
  "What does the Send trait mean and why does Rc not implement it?",
  "How does async/await differ from raw promise chaining in JavaScript?",
  "Compare how the Rust ownership chapter and the concurrency chapter each handle moving data between scopes.",
  "What did the agentic evaluation conclude, and how does that relate to where the latency waterfall says the time goes?",
  "Which is reported as more expensive in these notes: cross-encoder reranking or hybrid search, and by how much?",
];

interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
}

interface Sample {
  question: string;
  mode: string;
  ms: number;
  usage: Usage;
  toolCalls: number;
}

/** Drain the UI-message stream, keeping the final usage frame and counting tool calls. */
async function ask(question: string, mode: "single" | "agentic"): Promise<Sample> {
  const started = performance.now();
  const res = await fetch(`${base}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:1420" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: question }] }], mode }),
  });
  if (!res.ok || !res.body) throw new Error(`chat ${mode}: HTTP ${res.status}`);

  let usage: Usage = { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null };
  let toolCalls = 0;
  let buffer = "";
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
      let frame: { type?: string; messageMetadata?: { usage?: Usage } };
      try {
        frame = JSON.parse(line.slice(6));
      } catch {
        continue; // partial frame; the next chunk completes it
      }
      // Tool activity arrives as tool-* parts; counting starts is enough to show whether
      // the agent actually took a second hop on this question.
      if (frame.type?.startsWith("tool-input-start")) toolCalls++;
      if (frame.messageMetadata?.usage) usage = frame.messageMetadata.usage;
    }
  }
  return { question, mode, ms: Math.round(performance.now() - started), usage, toolCalls };
}

const model = ((await (await fetch(`${base}/config`, { headers: { Origin: "http://localhost:1420" } })).json()) as {
  model_name: string;
}).model_name;
const price = PRICES[model] ?? { input: 0, output: 0 };
if (!PRICES[model]) console.warn(`[cost] no price for "${model}" — reporting tokens only`);

const samples: Sample[] = [];
for (let run = 0; run < runs; run++) {
  for (const question of QUESTIONS) {
    for (const mode of ["single", "agentic"] as const) {
      const sample = await ask(question, mode);
      samples.push(sample);
      console.log(
        `[${run + 1}/${runs}] ${mode.padEnd(7)} ${String(sample.usage.totalTokens ?? "?").padStart(6)} tok ` +
          `${String(sample.ms).padStart(6)}ms tools=${sample.toolCalls}  ${question.slice(0, 48)}`,
      );
    }
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

const summarize = (mode: string) => {
  const rows = samples.filter((s) => s.mode === mode);
  const sum = (pick: (s: Sample) => number) => rows.reduce((a, s) => a + pick(s), 0);
  const input = sum((s) => s.usage.inputTokens ?? 0);
  const output = sum((s) => s.usage.outputTokens ?? 0);
  return {
    mode,
    n: rows.length,
    avgInput: Math.round(input / rows.length),
    avgOutput: Math.round(output / rows.length),
    avgTotal: Math.round((input + output) / rows.length),
    avgCostUsd: (input * price.input + output * price.output) / rows.length,
    medianMs: median(rows.map((s) => s.ms)),
    // How often agentic actually did anything different. A cost multiplier averaged over
    // questions the agent never used a tool on understates the real cost of the ones it did.
    usedTools: rows.filter((s) => s.toolCalls > 0).length,
  };
};

const single = summarize("single");
const agentic = summarize("agentic");
const report = { model, runs, questions: QUESTIONS.length, price, arms: [single, agentic], samples };

console.log(`\nmodel: ${model}   n=${single.n} per arm\n`);
console.log("arm      avg in   avg out   avg tot     avg $/req   median ms   used tools");
for (const a of [single, agentic]) {
  console.log(
    `${a.mode.padEnd(8)} ${String(a.avgInput).padStart(6)} ${String(a.avgOutput).padStart(9)} ` +
      `${String(a.avgTotal).padStart(9)} ${a.avgCostUsd.toFixed(6).padStart(13)} ${String(a.medianMs).padStart(11)} ` +
      `${String(a.usedTools).padStart(12)}/${a.n}`,
  );
}
const x = (b: number, a: number) => (a === 0 ? "n/a" : `${(b / a).toFixed(2)}x`);
console.log(`\nagentic vs single — tokens ${x(agentic.avgTotal, single.avgTotal)}, cost ${x(agentic.avgCostUsd, single.avgCostUsd)}, latency ${x(agentic.medianMs, single.medianMs)}`);

// The headline average is the least useful number here: cost is bimodal, because a
// question the model answers without tools costs roughly what single costs, and a
// question it takes hops on costs an order of magnitude more. Averaging across both
// overstates the cheap case and badly understates the expensive one, so report the
// split — paired per question, since question difficulty dominates the variance.
const paired = QUESTIONS.map((q) => ({
  q,
  single: samples.find((s) => s.question === q && s.mode === "single")!,
  agentic: samples.find((s) => s.question === q && s.mode === "agentic")!,
}));
const costOf = (s: Sample) => (s.usage.inputTokens ?? 0) * price.input + (s.usage.outputTokens ?? 0) * price.output;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

console.log("\nsplit by whether agentic actually called a tool:");
for (const [label, rows] of [
  ["called tools ", paired.filter((p) => p.agentic.toolCalls > 0)],
  ["no tool calls", paired.filter((p) => p.agentic.toolCalls === 0)],
] as const) {
  if (!rows.length) continue;
  const cs = mean(rows.map((r) => costOf(r.single)));
  const ca = mean(rows.map((r) => costOf(r.agentic)));
  const ts = mean(rows.map((r) => r.single.usage.totalTokens ?? 0));
  const ta = mean(rows.map((r) => r.agentic.usage.totalTokens ?? 0));
  console.log(
    `  ${label} n=${rows.length}  tokens ${Math.round(ts)} -> ${Math.round(ta)} (${x(ta, ts)})  ` +
      `cost $${cs.toFixed(6)} -> $${ca.toFixed(6)} (${x(ca, cs)})  ` +
      `median ms ${median(rows.map((r) => r.single.ms))} -> ${median(rows.map((r) => r.agentic.ms))}`,
  );
}
const worst = paired.reduce((a, b) => (costOf(b.agentic) / (costOf(b.single) || 1) > costOf(a.agentic) / (costOf(a.single) || 1) ? b : a));
console.log(`  worst single question: ${x(costOf(worst.agentic), costOf(worst.single))} — ${worst.q.slice(0, 60)}`);

if (out) {
  await Bun.write(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);
}
