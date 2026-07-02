// Config endpoints (GET/PUT /config, POST /config/test-llm).
// Ports backend/app/routers/config.py. Dependencies are injected so routes are
// unit-testable without Ollama or a live re-embed.
import { Hono } from "hono";
import { ZodError } from "zod";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";
import { saveConfig } from "./config.ts";
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

  app.get("/config", (c) => c.json(deps.getConfig()));

  app.put("/config", async (c) => {
    let next: AppConfig;
    try {
      next = AppConfigSchema.parse(await c.req.json());
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
    return c.json({ ...next, reembedding: languageChanged });
  });

  app.post("/config/test-llm", async (c) => c.json(await deps.testLlm(deps.getConfig())));

  return app;
}
