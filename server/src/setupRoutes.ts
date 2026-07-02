// Setup endpoints: GET /setup/status, POST /setup/complete.
// Ports backend/app/routers/setup.py for the TS stack: python/uv checks are gone, and
// Ollama is probed regardless of chat provider (embeddings always run on Ollama here,
// unlike Python's in-process sentence-transformers).
import { Hono } from "hono";
import type { AppConfig } from "../../shared/schema.ts";
import { saveConfig } from "./config.ts";
import type { FetchLike } from "./testLlm.ts";

export interface SetupRoutesDeps {
  dataDir: string;
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
  fetchFn?: FetchLike;
}

const PROBE_TIMEOUT_MS = 2000;

export function setupRoutes(deps: SetupRoutesDeps): Hono {
  const app = new Hono();
  const fetchFn = deps.fetchFn ?? fetch;

  app.get("/setup/status", async (c) => {
    const config = deps.getConfig();
    let ollamaOk = false;
    try {
      const res = await fetchFn(`${config.base_url.replace(/\/+$/, "")}/api/tags`, {
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      ollamaOk = res.status === 200;
    } catch {
      ollamaOk = false;
    }
    return c.json({ first_run: !config.first_run_complete, ollama_ok: ollamaOk });
  });

  app.post("/setup/complete", (c) => {
    const next = { ...deps.getConfig(), first_run_complete: true };
    saveConfig(next, deps.dataDir);
    deps.setConfig(next);
    return c.json({ ok: true });
  });

  return app;
}
