// KnowHive TS/bun sidecar entrypoint. Spawned by the Tauri shell as
// `bun run src/index.ts --port <port> --data-dir <dir>` (see src-tauri/src/sidecar.rs).
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamText, type ModelMessage, type UIMessage } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { parseArgs } from "./args.ts";
import { loadConfig } from "./config.ts";
import { openDb, vecVersion } from "./db.ts";
import { embed as ollamaEmbed, embeddingModelFor } from "./embed.ts";
import { ingestText, type Embedder } from "./ingest.ts";
import { hybridSearch } from "./store.ts";
import { buildSystemPrompt, extractSources, uiMessageText } from "./rag.ts";

const VERSION = "0.1.0";

const { port, dataDir } = parseArgs();
const db = openDb(dataDir);
const config = loadConfig(dataDir);

// Embedder bound to the configured Ollama endpoint + language→model mapping.
const embedder: Embedder = (texts) =>
  ollamaEmbed(texts, {
    baseUrl: config.base_url,
    model: embeddingModelFor(config.embedding_language),
  });

// Chat model via Ollama's OpenAI-compatible endpoint (/v1), consumed by the AI SDK.
const chatProvider = createOpenAICompatible({
  name: "ollama",
  baseURL: `${config.base_url}/v1`,
});

const app = new Hono();

// The renderer (WKWebView / localhost dev server) fetches this sidecar cross-origin.
app.use("*", cors());

// Health probe the Rust shell polls before flipping the sidecar to "running".
app.get("/health", (c) =>
  c.json({ status: "ok", version: VERSION, vec: vecVersion(db), provider: config.llm_provider }),
);

// Minimal setup gate the frontend checks on boot (full onboarding ported in Phase D).
app.get("/setup/status", (c) => c.json({ first_run: !config.first_run_complete }));

// Ingest local files by path (mirrors backend POST /ingest/files).
app.post("/ingest/files", async (c) => {
  const { paths } = (await c.req.json()) as { paths: string[] };
  const results = [];
  for (const path of paths) {
    try {
      const text = readFileSync(path, "utf8");
      results.push(await ingestText(db, path, text, embedder));
    } catch (err) {
      results.push({ filePath: path, chunkCount: 0, error: (err as Error).message });
    }
  }
  return c.json({ results });
});

// Hybrid retrieval (vector KNN ⊕ FTS5 via RRF). Used for Phase B verification and by the
// RAG retrieve step in Phase C.
app.post("/search", async (c) => {
  const { query, k = 5 } = (await c.req.json()) as { query: string; k?: number };
  const [queryVector] = await embedder([query]);
  const hits = hybridSearch(db, queryVector!, query, k);
  return c.json({ hits });
});

// RAG chat with streaming, consumed by the frontend's Vercel AI SDK useChat.
// MVP pipeline: retrieve context for the latest question → inject into the system prompt →
// stream the answer. Pre-retrieval strategies (rewrite/HyDE/multi-query) layer on next.
app.post("/chat", async (c) => {
  const { messages } = (await c.req.json()) as { messages: UIMessage[] };
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const question = uiMessageText(lastUser);

  const [queryVector] = await embedder([question]);
  const chunks = question ? hybridSearch(db, queryVector!, question, 5) : [];
  const system = buildSystemPrompt(chunks, config.custom_system_prompt);

  // Map UIMessages → plain model messages (avoids v7 convertToModelMessages quirks).
  const modelMessages: ModelMessage[] = messages
    .map((m) => ({ role: m.role, content: uiMessageText(m) }) as ModelMessage)
    .filter((m) => typeof m.content === "string" && m.content.length > 0);

  const result = streamText({
    model: chatProvider(config.model_name),
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

export default {
  port,
  hostname: "127.0.0.1",
  fetch: app.fetch,
};
