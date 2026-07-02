import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { loadConfig, saveConfig } from "./config.ts";
import { setupRoutes } from "./setupRoutes.ts";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";

// Ports backend/app/routers/setup.py for the TS stack: python/uv checks are gone,
// the readiness signal is Ollama (when the provider needs it) + first_run.

function setup(configOver: Record<string, unknown>, ollamaUp: boolean) {
  const dataDir = mkdtempSync(join(tmpdir(), "knowhive-setup-"));
  let config: AppConfig = AppConfigSchema.parse(configOver);
  saveConfig(config, dataDir);
  const app = new Hono().route(
    "/",
    setupRoutes({
      dataDir,
      getConfig: () => config,
      setConfig: (c) => {
        config = c;
      },
      fetchFn: async () => {
        if (!ollamaUp) throw new TypeError("Unable to connect");
        return new Response("{}", { status: 200 });
      },
    }),
  );
  return { app, dataDir, getConfig: () => config };
}

test("GET /setup/status: first run with Ollama up", async () => {
  const { app } = setup({}, true);
  const res = await app.request("/setup/status");
  expect(await res.json()).toEqual({ first_run: true, ollama_ok: true });
});

test("GET /setup/status: ollama down is reported for the ollama provider", async () => {
  const { app } = setup({}, false);
  expect(await (await app.request("/setup/status")).json()).toEqual({
    first_run: true,
    ollama_ok: false,
  });
});

test("GET /setup/status: cloud chat provider still probes Ollama (embeddings need it)", async () => {
  const { app } = setup({ llm_provider: "anthropic" }, false);
  expect((await (await app.request("/setup/status")).json()).ollama_ok).toBe(false);
});

test("POST /setup/complete persists first_run_complete and flips first_run", async () => {
  const { app, dataDir, getConfig } = setup({}, true);
  const res = await app.request("/setup/complete", { method: "POST" });
  expect(await res.json()).toEqual({ ok: true });
  expect(getConfig().first_run_complete).toBe(true);
  expect(loadConfig(dataDir).first_run_complete).toBe(true);
  expect((await (await app.request("/setup/status")).json()).first_run).toBe(false);
});
