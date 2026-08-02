// Config endpoints (GET/PUT /config, POST /config/test-llm).
// Ports backend/app/routers/config.py. Dependencies are injected so routes are
// unit-testable without Ollama or a live re-embed.
import { Hono } from "hono";
import { ZodError } from "zod";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";
import { maskApiKey, saveConfig, unmaskApiKey } from "./config.ts";
import type { TestLlmResult } from "./testLlm.ts";

export interface ConfigRoutesDeps {
  dataDir: string;
  getConfig: () => AppConfig;
  setConfig: (config: AppConfig) => void;
  /** Re-ingest the knowledge dir with the new embedding model. Fired in background. */
  reembed: (config: AppConfig) => Promise<void>;
  testLlm: (config: AppConfig) => Promise<TestLlmResult>;
}

export function configRoutes(deps: ConfigRoutesDeps): Hono {
  const app = new Hono();

  // The provider key never leaves the process in the clear — see localGuard.ts for
  // why "it's only on loopback" was not enough. Server-side consumers (chatModel,
  // test-llm) read deps.getConfig() directly and still see the real value.
  const publicView = (config: AppConfig) => ({ ...config, api_key: maskApiKey(config.api_key) });

  app.get("/config", (c) => c.json(publicView(deps.getConfig())));

  app.put("/config", async (c) => {
    let next: AppConfig;
    try {
      const body = (await c.req.json()) as Record<string, unknown>;
      // The Settings page round-trips the object GET handed it, so an untouched
      // key arrives as its own mask. Restore it before validation rather than
      // writing the mask over the real key.
      const stored = deps.getConfig().api_key;
      if ("api_key" in body) {
        body.api_key = unmaskApiKey(body.api_key as string | null, stored);
      }
      next = AppConfigSchema.parse(body);
    } catch (err) {
      if (err instanceof ZodError) return c.json({ detail: err.issues }, 422);
      throw err;
    }

    const languageChanged = deps.getConfig().embedding_language !== next.embedding_language;
    saveConfig(next, deps.dataDir);
    deps.setConfig(next);

    if (languageChanged) {
      // Background re-embed, mirrors FastAPI BackgroundTasks: respond immediately.
      deps.reembed(next).catch((err) => {
        console.error("[config] re-embed after language change failed:", err);
      });
    }
    return c.json({ ...publicView(next), reembedding: languageChanged });
  });

  app.post("/config/test-llm", async (c) => c.json(await deps.testLlm(deps.getConfig())));

  return app;
}
