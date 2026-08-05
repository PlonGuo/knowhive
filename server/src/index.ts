// KnowHive TS/bun sidecar entrypoint. Spawned by the Tauri shell as
// `bun run src/index.ts --port <port> --data-dir <dir>` (see src-tauri/src/sidecar.rs).
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isOriginAllowed, localGuard } from "./localGuard.ts";
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { parseArgs } from "./args.ts";
import { chatRoutes, EVICTION_POLICY } from "./chatRoutes.ts";
import { configPath, loadConfig } from "./config.ts";
import { configRoutes } from "./configRoutes.ts";
import { exportRoutes } from "./exportRoutes.ts";
import { openDb, vecVersion } from "./db.ts";
import { embed as ollamaEmbed, embeddingModelFor } from "./embed.ts";
import {
  findIngestableFiles,
  ingestDirectory,
  ingestIR,
  ingestLocalFile,
  ingestText,
  markDocumentError,
  type Embedder,
} from "./ingest.ts";
import { ingestRoutes } from "./ingestRoutes.ts";
import { PdfPluginSession, findPluginBin, isParseError } from "./pdfPlugin.ts";
import { pdfRoutes } from "./pdfRoutes.ts";
import { buildTree, createNoteFile, flattenTree, relativizeIfInside, resolveSafePath, updateNoteFile } from "./knowledge.ts";
import { knowledgeRoutes } from "./knowledgeRoutes.ts";
import { ollamaRoutes } from "./ollamaRoutes.ts";
import { memoryRoutes } from "./memoryRoutes.ts";
import { recallSemanticMemories, runEviction } from "./sessions.ts";
import { sessionRoutes } from "./sessionRoutes.ts";
import { setupRoutes } from "./setupRoutes.ts";
import { deleteChunksForFile, expandToParents, hybridSearch } from "./store.ts";
import { relevanceFloor, rerankCrossEncoder, type RerankObserver } from "./crossEncoder.ts";
import {
  crossEncoderScore,
  downloadStatus,
  isCrossEncoderLoaded,
  setModelCacheDir,
  warmup,
} from "./crossEncoderModel.ts";
import { RERANK_CANDIDATES, rerankChunks } from "./rerank.ts";
import { reviewRoutes } from "./reviewRoutes.ts";
import { SUMMARIZE_SYSTEM_PROMPT } from "./summary.ts";
import { summaryRoutes } from "./summaryRoutes.ts";
import { syncKnowledgeDir } from "./sync.ts";
import { runTestLlm } from "./testLlm.ts";
import { initTracing, shutdownTracing, traced, tracingActive } from "./tracing.ts";
import { FileWatcher } from "./watcher.ts";
import { watcherRoutes } from "./watcherRoutes.ts";

const VERSION = "0.1.0";

const { port, dataDir } = parseArgs();
const db = openDb(dataDir);
// Mutable: PUT /config swaps this at runtime; closures below read it per call.
let config = loadConfig(dataDir);

// User knowledge base lives inside the data dir (Python used ./knowledge relative cwd).
const knowledgeDir = join(dataDir, "knowledge");

// Reranker model cache also lives in the data dir — the packaged .app's resources
// are read-only, and transformers.js defaults to a relative cache path.
setModelCacheDir(join(dataDir, "models"));

// Embedder reading the live config each call (endpoint + language→model mapping).
// Embeddings ALWAYS come from local Ollama: base_url is the chat provider's URL,
// which may be a cloud API when llm_provider != ollama.
const ollamaUrl = () =>
  (config.llm_provider === "ollama" ? config.base_url : config.ollama_base_url).replace(/\/+$/, "");
const embedder: Embedder = (texts) =>
  ollamaEmbed(texts, {
    baseUrl: ollamaUrl(),
    model: embeddingModelFor(config.embedding_language),
  });

// PDF support is an optional external tool (knowhive-pdf via `uv tool install`).
// One session per ingest batch: docling's models are too heavy to keep idling,
// so ingestRoutes' afterTask closes it when the batch finishes.
let pdfSession: PdfPluginSession | null = null;
const closePdfSession = () => {
  pdfSession?.close();
  pdfSession = null;
};

const ingestPdf = async (absPath: string) => {
  pdfSession ??= new PdfPluginSession();
  const outcome = await pdfSession.parseOne(absPath);
  if (isParseError(outcome)) {
    const friendly =
      outcome.code === "needs_ocr"
        ? "Scanned PDF — OCR is not supported yet"
        : outcome.code === "bad_text_layer"
          ? "The PDF's text layer is broken or empty"
          : outcome.message || "PDF parsing failed";
    markDocumentError(db, absPath, `${outcome.code}: ${friendly}`);
    throw new Error(friendly);
  }
  const bytes = readFileSync(absPath);
  const fileHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  await ingestIR(db, absPath, outcome.ir, fileHash, bytes.byteLength, embedder);
};

// Read + index a single file; shared by ingest tasks, watcher sync and startup sync.
// md/txt/docx parse in-process; PDF goes through the external plugin session.
const ingestOne = async (absPath: string) => {
  if (absPath.toLowerCase().endsWith(".pdf")) {
    await ingestPdf(absPath);
    return;
  }
  await ingestLocalFile(db, absPath, embedder);
};

// Chat model for the configured provider, consumed by the AI SDK. Recreated per call
// so config changes (provider/base_url/key) take effect without restart. Ollama is
// reached through its OpenAI-compatible /v1; for openai-compatible the user's base_url
// already includes the version prefix (parity with the Python test-llm probe).
//
// includeUsage is NOT the default: the provider only sends stream_options.include_usage
// when asked, and an OpenAI-style server that is not asked omits usage from a streamed
// response entirely. DeepSeek volunteers it anyway, which is exactly why this stayed
// hidden — the cloud path had numbers, so the local path looking empty read as "Ollama
// doesn't report tokens" rather than "we never requested them". Without this flag the
// StatusBar's context-usage bar (inputTokens / model context limit) has no input on the
// default provider, and the prompt-cache hit rate is unmeasurable in-app.
const chatModel = () => {
  const base = config.base_url.replace(/\/+$/, "");
  const apiKey = config.api_key ?? undefined;
  switch (config.llm_provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: `${base}/v1` })(config.model_name);
    case "openai-compatible":
      return createOpenAICompatible({ name: "openai-compatible", baseURL: base, apiKey, includeUsage: true })(
        config.model_name,
      );
    default:
      return createOpenAICompatible({ name: "ollama", baseURL: `${base}/v1`, includeUsage: true })(
        config.model_name,
      );
  }
};

const app = new Hono();

// The renderer (WKWebView / localhost dev server) fetches this sidecar cross-origin,
// so CORS is required — but it must be an allowlist, not `cors()` with no options.
// Bare cors() answers `Access-Control-Allow-Origin: *`, which tells the browser it
// is fine to hand these responses to ANY site the user has open; combined with the
// fact that no route is authenticated, that exposed the whole knowledge base and
// the provider api_key to any page. localGuard additionally rejects non-loopback
// Host headers, which is what catches DNS rebinding (CORS cannot — see localGuard.ts).
app.use(
  "*",
  cors({ origin: (origin) => (isOriginAllowed(origin) ? origin : null) }),
);
app.use("*", localGuard());

// Health probe the Rust shell polls before flipping the sidecar to "running".
app.get("/health", (c) =>
  c.json({ status: "ok", version: VERSION, vec: vecVersion(db), provider: config.llm_provider }),
);

// Onboarding gate + completion: GET /setup/status, POST /setup/complete.
app.route(
  "/",
  setupRoutes({
    dataDir,
    getConfig: () => config,
    setConfig: (next) => {
      config = next;
    },
  }),
);

// Ollama model management for onboarding/settings: GET /ollama/status,
// POST /ollama/pull (streams NDJSON download progress through to the renderer).
app.route("/", ollamaRoutes({ getConfig: () => config }));

// Cross-encoder reranker status/download (Phase E2). "download" warms the lazy
// singleton (transformers.js fetches the ONNX model into its cache on first load).
app.get("/reranker/status", (c) =>
  c.json({
    available: true,
    model: "onnx-community/bge-reranker-v2-m3-ONNX (int8)",
    size_mb: 571,
    downloaded: isCrossEncoderLoaded(),
    loaded: isCrossEncoderLoaded(),
  }),
);
app.post("/reranker/download", (c) => {
  // First download is 571MB — runs in background; the frontend polls download-status.
  warmup();
  return c.json({ status: "started" });
});
app.get("/reranker/download-status", (c) => c.json(downloadStatus()));

// GET/PUT /config + POST /config/test-llm. A saved embedding_language change
// re-ingests the knowledge dir in the background with the new model.
app.route(
  "/",
  configRoutes({
    dataDir,
    getConfig: () => config,
    setConfig: (next) => {
      config = next;
    },
    reembed: async () => {
      const results = await ingestDirectory(db, knowledgeDir, embedder);
      console.log(`[config] re-embedded ${results.length} files after language change`);
    },
    testLlm: runTestLlm,
  }),
);

// Knowledge tree + file CRUD over the knowledge dir (edits re-index through the live embedder).
app.route(
  "/",
  knowledgeRoutes({
    knowledgeDir,
    db,
    reingest: async (absPath, content) => {
      await ingestText(db, absPath, content, embedder);
    },
  }),
);

// Watch the knowledge dir: edits made outside the app (e.g. Obsidian) sync into the index.
const watcher = new FileWatcher({
  knowledgeDir,
  onChange: async () => {
    const stats = await syncKnowledgeDir(db, knowledgeDir, ingestOne);
    console.log(
      `[watcher] sync: ${stats.new} new, ${stats.modified} modified, ${stats.deleted} deleted` +
        (stats.errors.length ? `, ${stats.errors.length} errors` : ""),
    );
  },
});
app.route("/", watcherRoutes({ watcher }));

// SM-2 spaced-repetition review: GET /review/due, POST /review/record, GET /review/stats.
app.route("/", reviewRoutes({ db }));

// Export: POST /export/full (zip), POST /export/chat (json), POST /export/file (bytes).
app.route("/", exportRoutes({ db, knowledgeDir, configPath: configPath(dataDir) }));

// Cached LLM document summaries: GET /summary/file, POST /summary/{cached,generate,batch}.
app.route(
  "/",
  summaryRoutes({
    db,
    knowledgeDir,
    generate: async (content, filePath) => {
      const { text } = await generateText({
        model: chatModel(),
        system: SUMMARIZE_SYSTEM_PROMPT,
        prompt: `Document: ${filePath}\n\n${content}`,
      });
      return text;
    },
  }),
);

// Ingest with task tracking: POST /ingest/files, GET /ingest/status/:id, POST /ingest/resync.
app.route(
  "/",
  ingestRoutes({
    db,
    knowledgeDir,
    ingestFile: ingestOne,
    // Resync sweeps PDFs only when the plugin is installed; without it a stray
    // PDF would just fail per-file with "plugin not installed".
    listFiles: (dir) => findIngestableFiles(dir, { includePdf: findPluginBin() !== null }),
    afterTask: closePdfSession,
  }),
);

// PDF plugin management: GET /pdf/status, POST /pdf/install, GET /pdf/install-status.
app.route("/", pdfRoutes());

// Retrieve: hybrid (vector KNN ⊕ FTS5 via RRF), and when use_reranker is on,
// over-fetch RERANK_CANDIDATES and rerank down to k with the configured backend:
// "cross-encoder" = in-process ONNX (Phase E2), "llm" = LLM-as-reranker (Phase E1).
//
// Parent-child (config.use_parent_expansion) applies LAST, after reranking: ranking wants
// the small, precise child text, while the model wants the surrounding passage. Expanding
// before the rerank would hand the cross-encoder diluted passages and undo the point.
// Tracing note: the spans below sit at exactly the same seams as the KNOWHIVE_TIMING
// probes. That is deliberate — one set of instrumentation points, two products (a
// millisecond number for the latency waterfall, a span with inputs/outputs for Langfuse),
// so the two can never disagree about where a boundary is.
const retrieve = async (query: string, k: number, precomputedVector?: number[]) =>
  traced("retrieve", "chain", async (rec) => {
    const ranked = await retrieveRanked(query, k, precomputedVector);
    if (!config.use_parent_expansion) {
      rec.set({ input: { query, k }, output: { chunks: ranked.length, expanded: false } });
      return ranked;
    }
    // Expansion is last on purpose: ranking wants the small precise child, the model
    // wants the surrounding passage.
    const expanded = traced("expand-to-parents", "span", (span) => {
      const out = expandToParents(db, ranked);
      span.set({
        input: { children: ranked.length },
        // Fewer-but-complete is the expected shape here, not a bug — several children
        // routinely collapse into one parent.
        output: { parents: out.length, sources: sourcePaths(out) },
      });
      return out;
    });
    rec.set({ input: { query, k }, output: { chunks: expanded.length, expanded: true } });
    return expanded;
  });

/** File paths of a hit list — the one field that makes a retrieval span readable at a glance. */
const sourcePaths = (rows: { file_path?: string }[]) => rows.map((r) => r.file_path).filter(Boolean);

const retrieveRanked = async (query: string, k: number, precomputedVector?: number[]) => {
  // Env-gated internal split (KNOWHIVE_TIMING=1) so the latency waterfall can drill
  // into retrieve when it dominates: embed vs hybrid-search vs rerank.
  const T = process.env.KNOWHIVE_TIMING ? () => performance.now() : null;
  const t0 = T ? T() : 0;
  // /chat passes a shared vector so the question is embedded once, not twice.
  const queryVector =
    precomputedVector ??
    (await traced("embed-query", "embedding", async (rec) => {
      const vec = (await embedder([query]))[0];
      rec.set({ input: query, output: { dimensions: vec?.length ?? 0 } });
      return vec;
    }));
  const t1 = T ? T() : 0;
  if (!config.use_reranker) {
    const hits = traced("hybrid-search", "retriever", (rec) => {
      const out = hybridSearch(db, queryVector!, query, k);
      rec.set({ input: { query, k }, output: { hits: out.length, sources: sourcePaths(out) } });
      return out;
    });
    if (T) console.log(`[timing.retrieve] embed=${Math.round(t1 - t0)}ms search=${Math.round(T() - t1)}ms rerank=0ms`);
    return hits;
  }

  const candidates = traced("hybrid-search", "retriever", (rec) => {
    const out = hybridSearch(db, queryVector!, query, RERANK_CANDIDATES);
    rec.set({
      input: { query, k: RERANK_CANDIDATES },
      output: { hits: out.length, sources: sourcePaths(out) },
    });
    return out;
  });
  const t2 = T ? T() : 0;

  if (config.reranker_backend === "cross-encoder") {
    // Relevance gate: [] here means "searched, found nothing relevant" and flows into
    // buildContextBlock's abstention text. Only this branch has calibrated scores —
    // the LLM reranker returns a ranking, not comparable magnitudes.
    const floor = relevanceFloor(process.env.KNOWHIVE_RELEVANCE_FLOOR);
    const hits = await traced("rerank-cross-encoder", "retriever", async (rec) => {
      // Captured from the observer so the gate span can report WHY it abstained; without
      // it an empty result is indistinguishable from a reranker that failed open.
      // A holder rather than a `let`: TS cannot see that the observer callback runs, so a
      // plain binding stays narrowed to `null` and every read below becomes `never`.
      const gate: { info: Parameters<RerankObserver>[0] | null } = { info: null };
      const out = await rerankCrossEncoder(query, candidates, k, crossEncoderScore, floor, (info) => {
        gate.info = info;
      });
      rec.set({
        input: { query, candidates: candidates.length, k },
        output: { hits: out.length, sources: sourcePaths(out) },
        metadata: { topScore: gate.info?.topScore ?? null, scored: gate.info !== null },
      });
      traced("abstention-gate", "guardrail", (span) =>
        span.set({
          input: { topScore: gate.info?.topScore ?? null, floor },
          output: {
            // "not-scored" is the fail-open path: the reranker threw and we degraded to
            // hybrid order, which is NOT evidence about the corpus and must not read as a pass.
            decision: gate.info === null ? "not-scored" : gate.info.abstained ? "abstain" : "answer",
          },
        }),
      );
      return out;
    });
    if (T) console.log(`[timing.retrieve] embed=${Math.round(t1 - t0)}ms search=${Math.round(t2 - t1)}ms rerank=${Math.round(T() - t2)}ms`);
    return hits;
  }
  return traced("rerank-llm", "retriever", async (rec) => {
    const out = await rerankChunks(
      query,
      candidates,
      k,
      async (prompt) => {
        const { text } = await generateText({ model: chatModel(), prompt, temperature: 0 });
        return text;
      },
      // "coverage" won the k-sweep (learnings/evals/Reranker-K-Sweep.md): best precision AND
      // recall at k=5. The env override remains for re-running the A/B.
      process.env.KNOWHIVE_RERANK_STYLE === "relevance" ? "relevance" : "coverage",
    );
    rec.set({
      input: { query, candidates: candidates.length, k },
      output: { hits: out.length, sources: sourcePaths(out) },
      // No gate on this path: the LLM reranker returns a ranking, not comparable scores.
      metadata: { gated: false },
    });
    return out;
  });
};

// Used for Phase B verification, the RAG retrieve step, and the RAGAS eval adapter.
app.post("/search", async (c) => {
  const { query, k = 5 } = (await c.req.json()) as { query: string; k?: number };
  return c.json({ hits: await retrieve(query, k) });
});

// RAG chat with streaming (single-pass RAG or Phase G agentic tool loop) — see chatRoutes.ts.
app.route(
  "/",
  chatRoutes({
    getConfig: () => config,
    chatModel,
    retrieve,
    readNote: (relPath) => {
      const rel = relativizeIfInside(knowledgeDir, relPath);
      const abs = resolveSafePath(knowledgeDir, rel);
      return { path: rel, content: readFileSync(abs, "utf8") };
    },
    listNotePaths: () => flattenTree(buildTree(knowledgeDir)),
    db,
    // Summarizer for compression+distillation follows the main chat model.
    generate: async (prompt) => {
      const { text } = await generateText({ model: chatModel(), prompt, temperature: 0 });
      return text;
    },
    embedFacts: (facts) => embedder(facts),
    embedQuery: async (text) => (await embedder([text]))[0]!,
    recallMemories: async (question, queryVector) => {
      const vec = queryVector ?? (await embedder([question]))[0];
      return recallSemanticMemories(db, vec!, { k: 3, minSimilarity: 0.5 });
    },
    // Agent write tools (Phase H) — reuse the knowledge services and keep the
    // index in sync exactly like the HTTP handlers do.
    writeNotes: {
      create: async (relPath, content) => {
        const rel = relativizeIfInside(knowledgeDir, relPath);
        const abs = createNoteFile(knowledgeDir, rel, content);
        await ingestText(db, abs, content, embedder);
        return { path: rel, bytes: content.length };
      },
      update: async (relPath, content) => {
        const rel = relativizeIfInside(knowledgeDir, relPath);
        const abs = updateNoteFile(knowledgeDir, rel, content);
        await ingestText(db, abs, content, embedder);
        return { path: rel, bytes: content.length };
      },
      remove: async (relPath) => {
        const rel = relativizeIfInside(knowledgeDir, relPath);
        const abs = resolveSafePath(knowledgeDir, rel);
        deleteChunksForFile(db, abs);
        db.run("DELETE FROM documents WHERE file_path = ?", [abs]);
        unlinkSync(abs);
        return { path: rel };
      },
    },
  }),
);

// Chat sessions (Phase M): list/create/read/delete conversations.
app.route("/", sessionRoutes({ db }));

// Memory management (Phase M3): the user sees/edits/deletes learned memories.
app.route("/", memoryRoutes({ db, embedFacts: (facts) => embedder(facts) }));
// Startup eviction sweep (LRU cap on semantic, TTL on episodic).
runEviction(db, EVICTION_POLICY);

// Tracing (dev only — no keys, no import, no signal handlers). Fire-and-forget: a
// request arriving before init resolves is simply untraced, which beats delaying startup.
void initTracing().then(() => {
  if (!tracingActive()) return;
  // Only registered when tracing is on, so the off path keeps its exact previous exit
  // behaviour. The exporter batches, so a sidecar killed by the shell would otherwise
  // drop the spans it had not flushed yet.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => void shutdownTracing().finally(() => process.exit(0)));
  }
});

console.log(
  `[server] KnowHive sidecar listening on http://127.0.0.1:${port} ` +
    `(data-dir=${dataDir}, sqlite-vec=${vecVersion(db)})`,
);

// Startup sync + watcher autostart (mirrors backend/app/main.py lifespan). Runs in the
// background so /health responds immediately; the knowledge dir must exist for fs.watch.
mkdirSync(knowledgeDir, { recursive: true });
syncKnowledgeDir(db, knowledgeDir, ingestOne)
  .then((stats) =>
    console.log(`[server] startup sync: ${stats.new} new, ${stats.modified} modified, ${stats.deleted} deleted`),
  )
  .catch((err) => console.error("[server] startup sync failed:", err))
  .finally(() => watcher.start());

// Orphan watchdog: if the Tauri shell dies without signalling us (macOS quit paths
// that skip ExitRequested, force-quit, crash), we get reparented to launchd (ppid 1)
// — exit instead of lingering as a zombie server. Opt-in via env (set by the Rust
// shell's spawn): standalone runs (eval scripts, manual curl sessions) background
// the sidecar from transient shells and must not be killed by reparenting.
if (process.env.KNOWHIVE_PARENT_WATCHDOG) {
  setInterval(() => {
    if (process.ppid === 1) {
      console.log("[server] parent process gone, shutting down");
      process.exit(0);
    }
  }, 2000);
}

export default {
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
  // Bun.serve kills requests idle for 10s by default — too tight for a cold Ollama's
  // first chat token. Long work (model download) is async + polled, not long requests.
  idleTimeout: 120,
};
