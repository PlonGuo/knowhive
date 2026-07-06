// KnowHive TS/bun sidecar entrypoint. Spawned by the Tauri shell as
// `bun run src/index.ts --port <port> --data-dir <dir>` (see src-tauri/src/sidecar.rs).
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { generateText, streamText, type ModelMessage, type UIMessage } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { parseArgs } from "./args.ts";
import { configPath, loadConfig } from "./config.ts";
import { configRoutes } from "./configRoutes.ts";
import { exportRoutes } from "./exportRoutes.ts";
import { openDb, vecVersion } from "./db.ts";
import { embed as ollamaEmbed, embeddingModelFor } from "./embed.ts";
import { ingestDirectory, ingestText, type Embedder } from "./ingest.ts";
import { ingestRoutes } from "./ingestRoutes.ts";
import { knowledgeRoutes } from "./knowledgeRoutes.ts";
import { ollamaRoutes } from "./ollamaRoutes.ts";
import { setupRoutes } from "./setupRoutes.ts";
import { hybridSearch } from "./store.ts";
import { buildSystemPrompt, extractSources, uiMessageText } from "./rag.ts";
import { rerankCrossEncoder } from "./crossEncoder.ts";
import { crossEncoderScore, isCrossEncoderLoaded } from "./crossEncoderModel.ts";
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

// Embedder reading the live config each call (endpoint + language→model mapping).
const embedder: Embedder = (texts) =>
  ollamaEmbed(texts, {
    baseUrl: config.base_url,
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
app.post("/reranker/download", async (c) => {
  await crossEncoderScore("warmup", ["warmup"]); // triggers download + load
  return c.json({ status: "complete" });
});
app.get("/reranker/download-status", (c) =>
  c.json({ status: isCrossEncoderLoaded() ? "complete" : null }),
);

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

// RAG chat with streaming, consumed by the frontend's Vercel AI SDK useChat.
// MVP pipeline: retrieve context for the latest question → inject into the system prompt →
// stream the answer. Pre-retrieval strategies (rewrite/HyDE/multi-query) layer on next.
app.post("/chat", async (c) => {
  const { messages } = (await c.req.json()) as { messages: UIMessage[] };
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = uiMessageText(lastUser);

  const chunks = question ? await retrieve(question, 5) : [];
  const system = buildSystemPrompt(chunks, config.custom_system_prompt);

  // Map UIMessages → plain model messages (avoids v7 convertToModelMessages quirks).
  const modelMessages: ModelMessage[] = messages
    .map((m) => ({ role: m.role, content: uiMessageText(m) }) as ModelMessage)
    .filter((m) => typeof m.content === "string" && m.content.length > 0);

  const result = streamText({
    model: chatModel(),
    system,
    messages: modelMessages,
  });

  // Surface retrieved sources to the UI as message metadata.
  return result.toUIMessageStreamResponse({
    messageMetadata: () => ({ sources: extractSources(chunks) }),
  });
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

export default {
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};
