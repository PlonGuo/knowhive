// Ollama endpoints (R3): GET /ollama/status, POST /ollama/pull (streaming proxy).
// The pull proxy forwards Ollama's NDJSON progress stream to the renderer so the
// onboarding UI can show live download progress.
import { Hono } from "hono";
import type { AppConfig } from "../../shared/schema.ts";
import { buildOllamaStatus, requiredModels } from "./ollama.ts";
import type { FetchLike } from "./testLlm.ts";

export interface OllamaRoutesDeps {
  getConfig: () => AppConfig;
  fetchFn?: FetchLike;
}

const STATUS_TIMEOUT_MS = 2000;

export function ollamaRoutes(deps: OllamaRoutesDeps): Hono {
  const app = new Hono();
  const fetchFn = deps.fetchFn ?? fetch;
  // Ollama endpoint: base_url only when Ollama IS the chat provider; otherwise the
  // dedicated ollama_base_url (base_url then points at a cloud chat API).
  const baseUrl = () => {
    const config = deps.getConfig();
    const url = config.llm_provider === "ollama" ? config.base_url : config.ollama_base_url;
    return url.replace(/\/+$/, "");
  };

  app.get("/ollama/status", async (c) => {
    const config = deps.getConfig();
    try {
      const res = await fetchFn(`${baseUrl()}/api/tags`, {
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { models?: { name: string }[] };
      return c.json(buildOllamaStatus((data.models ?? []).map((m) => m.name), config));
    } catch {
      return c.json({
        running: false,
        models: [],
        required: requiredModels(config).map((r) => ({ ...r, installed: false })),
      });
    }
  });

  // Context window of the configured chat model, for the client usage gauge.
  // Reads `*.context_length` from /api/show's model_info (key is arch-prefixed,
  // e.g. "llama.context_length"). Degrades to null when Ollama is unreachable.
  app.get("/ollama/context", async (c) => {
    const model = deps.getConfig().model_name;
    try {
      const res = await fetchFn(`${baseUrl()}/api/show`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const data = (await res.json()) as { model_info?: Record<string, unknown> };
      const key = Object.keys(data.model_info ?? {}).find((k) => k.endsWith(".context_length"));
      const raw = key ? data.model_info?.[key] : undefined;
      const contextLength = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
      return c.json({ model, context_length: contextLength });
    } catch {
      return c.json({ model, context_length: null });
    }
  });

  app.post("/ollama/pull", async (c) => {
    const { model } = (await c.req.json()) as { model?: string };
    if (!model || typeof model !== "string") {
      return c.json({ detail: "model is required" }, 422);
    }

    const upstream = await fetchFn(`${baseUrl()}/api/pull`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!upstream.ok || !upstream.body) {
      return c.json(
        { detail: `Ollama pull failed (${upstream.status}): ${await upstream.text()}` },
        upstream.status === 404 ? 404 : 502,
      );
    }
    return c.body(upstream.body, 200, { "Content-Type": "application/x-ndjson" });
  });

  return app;
}
