// Does a large ingest degrade chat, and if so, where does it break?
//
// The honest answer so far has been "single user, so it never happens" — an assumption,
// not a measurement. It is also not true: the file watcher re-indexes on external edits,
// so a background ingest can start while the user is mid-conversation without anyone
// choosing it.
//
// Both paths share one bun:sqlite handle and one Ollama instance, so there are two
// plausible failure modes and they need different fixes:
//   - SQLite write contention: ingest's transactions block chat's reads (SQLITE_BUSY,
//     or just latency).
//   - Ollama queueing: embedding calls and chat generation compete for the same runner,
//     which shows up as latency with no error at all.
//
//   bun run spike-concurrency.ts --port 18291 --corpus <dir> [--chats 5] [--copies 30]
//
// Arm A measures chat on an idle server; arm B fires the same chats while an ingest of
// `copies` files runs. Same questions, same order, so the difference is the load.

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1]! : fallback;
};

const port = arg("port", "18291")!;
const corpus = arg("corpus");
const chats = Number(arg("chats", "5"));
const copies = Number(arg("copies", "30"));
const out = arg("out");
const base = `http://127.0.0.1:${port}`;
const headers = { "Content-Type": "application/json", Origin: "http://localhost:1420" };

if (!corpus) throw new Error("--corpus <dir of .md files to stage for ingest> is required");

const QUESTION = "What are the three rules of ownership in Rust?";

interface ChatResult {
  ok: boolean;
  status: number;
  ttftMs: number | null;
  totalMs: number;
  chars: number;
  error?: string;
}

/** One chat request, timing first byte separately: a stall shows up in TTFT first. */
async function chat(): Promise<ChatResult> {
  const started = performance.now();
  let ttftMs: number | null = null;
  let chars = 0;
  try {
    const res = await fetch(`${base}/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: QUESTION }] }] }),
    });
    if (!res.ok || !res.body) {
      return { ok: false, status: res.status, ttftMs: null, totalMs: Math.round(performance.now() - started), chars: 0, error: `HTTP ${res.status}` };
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      ttftMs ??= Math.round(performance.now() - started);
      chars += value.length;
      // An error frame mid-stream returns HTTP 200, so status alone would call this a pass.
      if (value.includes('"type":"error"')) {
        return { ok: false, status: 200, ttftMs, totalMs: Math.round(performance.now() - started), chars, error: "error frame in stream" };
      }
    }
    return { ok: true, status: 200, ttftMs, totalMs: Math.round(performance.now() - started), chars };
  } catch (err) {
    return { ok: false, status: 0, ttftMs, totalMs: Math.round(performance.now() - started), chars, error: String(err) };
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2]! : Math.round((s[s.length / 2 - 1]! + s[s.length / 2]!) / 2)) : 0;
};

async function runChats(label: string, n: number): Promise<ChatResult[]> {
  const results: ChatResult[] = [];
  for (let i = 0; i < n; i++) {
    const r = await chat();
    results.push(r);
    console.log(`  [${label}] #${i + 1} ttft=${r.ttftMs ?? "-"}ms total=${r.totalMs}ms ${r.ok ? "ok" : "FAIL " + r.error}`);
  }
  return results;
}

const summarize = (label: string, rs: ChatResult[]) => ({
  arm: label,
  n: rs.length,
  failures: rs.filter((r) => !r.ok).length,
  medianTtftMs: median(rs.filter((r) => r.ttftMs != null).map((r) => r.ttftMs!)),
  medianTotalMs: median(rs.map((r) => r.totalMs)),
  maxTotalMs: Math.max(...rs.map((r) => r.totalMs)),
});

console.log(`arm A — idle server, ${chats} chats`);
const armA = await runChats("idle", chats);

// Stage the ingest payload: copies of the corpus files under fresh names, so every one
// is genuinely new work (the hash check skips unchanged files).
const { readdirSync, readFileSync, writeFileSync, mkdirSync } = await import("node:fs");
const { join } = await import("node:path");
const stage = join(corpus, "..", "_concurrency_stage");
mkdirSync(stage, { recursive: true });
const sources = readdirSync(corpus).filter((f) => f.endsWith(".md"));
if (!sources.length) throw new Error(`no .md files in ${corpus}`);
const staged: string[] = [];
for (let i = 0; i < copies; i++) {
  const src = sources[i % sources.length]!;
  const dest = join(stage, `load-${i}-${src}`);
  writeFileSync(dest, readFileSync(join(corpus, src)));
  staged.push(dest);
}
console.log(`\nstaged ${staged.length} files for ingest`);

const task = (await (await fetch(`${base}/ingest/files`, { method: "POST", headers, body: JSON.stringify({ file_paths: staged }) })).json()) as {
  task_id: string;
};
console.log(`ingest task ${task.task_id} started\n`);

console.log(`arm B — ${chats} chats while that ingest runs`);
const armB = await runChats("loaded", chats);

const status = (await (await fetch(`${base}/ingest/status/${task.task_id}`, { headers })).json()) as {
  status?: string;
  processed?: number;
  total?: number;
};
console.log(`\ningest at end of arm B: ${JSON.stringify(status)}`);

const a = summarize("idle", armA);
const b = summarize("loaded", armB);
console.log("\narm      n  fail  median ttft  median total  max total");
for (const s of [a, b]) {
  console.log(`${s.arm.padEnd(8)} ${String(s.n).padStart(1)}  ${String(s.failures).padStart(4)}  ${String(s.medianTtftMs).padStart(11)}  ${String(s.medianTotalMs).padStart(12)}  ${String(s.maxTotalMs).padStart(9)}`);
}
const ratio = (x: number, y: number) => (y === 0 ? "n/a" : `${(x / y).toFixed(2)}x`);
console.log(`\nunder ingest load — ttft ${ratio(b.medianTtftMs, a.medianTtftMs)}, total ${ratio(b.medianTotalMs, a.medianTotalMs)}, failures ${b.failures}/${b.n}`);

if (out) {
  await Bun.write(out, JSON.stringify({ chats, copies, arms: [a, b], armA, armB, ingest: status }, null, 2));
  console.log(`wrote ${out}`);
}
