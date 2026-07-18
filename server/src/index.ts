// KnowHive TS/bun sidecar entrypoint. Spawned by the Tauri shell as
// `bun run src/index.ts --port <port> --data-dir <dir>` (see src-tauri/src/sidecar.rs).
import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
import { ingestDirectory, ingestText, type Embedder } from "./ingest.ts";
import { ingestRoutes } from "./ingestRoutes.ts";
import { buildTree, createNoteFile, flattenTree, relativizeIfInside, resolveSafePath, updateNoteFile } from "./knowledge.ts";
import { knowledgeRoutes } from "./knowledgeRoutes.ts";
import { ollamaRoutes } from "./ollamaRoutes.ts";
import { memoryRoutes } from "./memoryRoutes.ts";
import { recallSemanticMemories, runEviction } from "./sessions.ts";
import { sessionRoutes } from "./sessionRoutes.ts";
import { setupRoutes } from "./setupRoutes.ts";
import { deleteChunksForFile, hybridSearch } from "./store.ts";
import { rerankCrossEncoder } from "./crossEncoder.ts";
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

// Read + index a single file; shared by ingest tasks, watcher sync and startup sync.
const ingestOne = async (absPath: string) => {
  await ingestText(db, absPath, readFileSync(absPath, "utf8"), embedder);
};

// Chat model for the configured provider, consumed by the AI SDK. Recreated per call
// so config changes (provider/base_url/key) take effect without restart. Ollama is
// reached through its OpenAI-compatible /v1; for openai-compatible the user's base_url
// already includes the version prefix (parity with the Python test-llm probe).
const chatModel = () => {
  const base = config.base_url.replace(/\/+$/, "");
  const apiKey = config.api_key ?? undefined;
  switch (config.llm_provider) {
    case "anthropic":
      return createAnthropic({ apiKey, baseURL: `${base}/v1` })(config.model_name);
    case "openai-compatible":
      return createOpenAICompatible({ name: "openai-compatible", baseURL: base, apiKey })(
        config.model_name,
      );
    default:
      return createOpenAICompatible({ name: "ollama", baseURL: `${base}/v1` })(config.model_name);
  }
};

const app = new Hono();

// The renderer (WKWebView / localhost dev server) fetches this sidecar cross-origin.
app.use("*", cors());

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
  ingestRoutes({ db, knowledgeDir, ingestFile: ingestOne }),
);

// Retrieve: hybrid (vector KNN ⊕ FTS5 via RRF), and when use_reranker is on,
// over-fetch RERANK_CANDIDATES and rerank down to k with the configured backend:
// "cross-encoder" = in-process ONNX (Phase E2), "llm" = LLM-as-reranker (Phase E1).
const retrieve = async (query: string, k: number, precomputedVector?: number[]) => {
  // Env-gated internal split (KNOWHIVE_TIMING=1) so the latency waterfall can drill
  // into retrieve when it dominates: embed vs hybrid-search vs rerank.
  const T = process.env.KNOWHIVE_TIMING ? () => performance.now() : null;
  const t0 = T ? T() : 0;
  // /chat passes a shared vector so the question is embedded once, not twice.
  const queryVector = precomputedVector ?? (await embedder([query]))[0];
  const t1 = T ? T() : 0;
  if (!config.use_reranker) {
    const hits = hybridSearch(db, queryVector!, query, k);
    if (T) console.log(`[timing.retrieve] embed=${Math.round(t1 - t0)}ms search=${Math.round(T() - t1)}ms rerank=0ms`);
    return hits;
  }

  const candidates = hybridSearch(db, queryVector!, query, RERANK_CANDIDATES);
  const t2 = T ? T() : 0;

  if (config.reranker_backend === "cross-encoder") {
    const hits = await rerankCrossEncoder(query, candidates, k, crossEncoderScore);
    if (T) console.log(`[timing.retrieve] embed=${Math.round(t1 - t0)}ms search=${Math.round(t2 - t1)}ms rerank=${Math.round(T() - t2)}ms`);
    return hits;
  }
  return rerankChunks(
    query,
    candidates,
    k,
    async (prompt) => {
      const { text } = await generateText({ model: chatModel(), prompt, temperature: 0 });
      return text;
    },
    // "coverage" won the k-sweep (learnings/Reranker-K-Sweep.md): best precision AND
    // recall at k=5. The env override remains for re-running the A/B.
    process.env.KNOWHIVE_RERANK_STYLE === "relevance" ? "relevance" : "coverage",
  );
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
