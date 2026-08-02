import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { configRoutes, type ConfigRoutesDeps } from "./configRoutes.ts";
import { loadConfig, saveConfig } from "./config.ts";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";

// Parity tests against backend/app/routers/config.py (GET/PUT /config, POST /config/test-llm).

function makeApp(over: Partial<ConfigRoutesDeps> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "knowhive-cfgroutes-"));
  let current = loadConfig(dataDir);
  const reembedCalls: AppConfig[] = [];
  const deps: ConfigRoutesDeps = {
    dataDir,
    getConfig: () => current,
    setConfig: (c) => {
      current = c;
    },
    reembed: async (c) => {
      reembedCalls.push(c);
    },
    testLlm: async () => ({ success: true, message: "LLM connection successful" }),
    ...over,
  };
  const app = new Hono().route("/", configRoutes(deps));
  return { app, dataDir, reembedCalls, getCurrent: () => current };
}

test("GET /config returns the current config", async () => {
  const { app } = makeApp();
  const res = await app.request("/config");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.model_name).toBe("llama3.2");
  expect(body.embedding_language).toBe("english");
});

test("PUT /config persists to disk, updates runtime state, reembedding:false", async () => {
  const { app, dataDir, reembedCalls, getCurrent } = makeApp();
  const next = AppConfigSchema.parse({ model_name: "qwen3", chat_memory_turns: 3 });
  const res = await app.request("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(next),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.reembedding).toBe(false);
  expect(body.model_name).toBe("qwen3");
  expect(loadConfig(dataDir).model_name).toBe("qwen3");
  expect(getCurrent().chat_memory_turns).toBe(3);
  expect(reembedCalls.length).toBe(0);
});

test("PUT /config with changed embedding_language triggers reembed and reembedding:true", async () => {
  const { app, dataDir, reembedCalls } = makeApp();
  saveConfig(AppConfigSchema.parse({ embedding_language: "english" }), dataDir);
  const res = await app.request("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(AppConfigSchema.parse({ embedding_language: "mixed" })),
  });
  const body = await res.json();
  expect(body.reembedding).toBe(true);
  expect(reembedCalls.length).toBe(1);
  expect(reembedCalls[0]!.embedding_language).toBe("mixed");
});

test("PUT /config with partial body fills defaults (pydantic parity)", async () => {
  const { app } = makeApp();
  const res = await app.request("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "qwen3" }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.base_url).toBe("http://localhost:11434");
});

test("PUT /config with invalid values returns 422 (FastAPI parity)", async () => {
  const { app, reembedCalls } = makeApp();
  const res = await app.request("/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ llm_provider: "not-a-provider" }),
  });
  expect(res.status).toBe(422);
  expect(reembedCalls.length).toBe(0);
});

test("POST /config/test-llm returns the probe result", async () => {
  const { app } = makeApp({ testLlm: async () => ({ success: false, error: "LLM returned status 500" }) });
  const res = await app.request("/config/test-llm", { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: false, error: "LLM returned status 500" });
});

// --- api_key must not leave the process in the clear -------------------------

test("GET /config masks the api_key", async () => {
  const { app, getCurrent, dataDir } = makeApp();
  const withKey = AppConfigSchema.parse({ ...getCurrent(), api_key: "sk-abcdefghijklmnop" });
  saveConfig(withKey, dataDir);
  const app2 = makeApp({ getConfig: () => withKey });
  const body = await (await app2.app.request("/config")).json();
  expect(body.api_key).toBe("••••••••mnop");
  expect(body.api_key).not.toContain("abcdefgh");
  void app;
});

test("PUT /config echoing the mask back preserves the stored key", async () => {
  const stored = AppConfigSchema.parse({ api_key: "sk-abcdefghijklmnop" });
  let current = stored;
  const { app } = makeApp({ getConfig: () => current, setConfig: (c) => { current = c; } });

  const shown = await (await app.request("/config")).json();
  const res = await app.request("/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    // Simulate the Settings page: round-trip the object it was given, edit something else.
    body: JSON.stringify({ ...shown, model_name: "deepseek-chat" }),
  });
  expect(res.status).toBe(200);
  expect(current.api_key).toBe("sk-abcdefghijklmnop");
  expect(current.model_name).toBe("deepseek-chat");
});

test("PUT /config accepts a genuinely new key and never echoes it back in the clear", async () => {
  let current = AppConfigSchema.parse({ api_key: "sk-old-value-here" });
  const { app } = makeApp({ getConfig: () => current, setConfig: (c) => { current = c; } });
  const res = await app.request("/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...current, api_key: "sk-brand-new-key-9999" }),
  });
  const body = await res.json();
  expect(current.api_key).toBe("sk-brand-new-key-9999");
  expect(body.api_key).toBe("••••••••9999");
});

test("PUT /config can clear the api_key", async () => {
  let current = AppConfigSchema.parse({ api_key: "sk-old-value-here" });
  const { app } = makeApp({ getConfig: () => current, setConfig: (c) => { current = c; } });
  await app.request("/config", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...current, api_key: null }),
  });
  expect(current.api_key).toBeNull();
});
