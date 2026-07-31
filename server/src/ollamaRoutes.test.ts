import { test, expect } from "bun:test";
import { Hono } from "hono";
import { ollamaRoutes } from "./ollamaRoutes.ts";
import { loadConfig } from "./config.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// R3: GET /ollama/status + POST /ollama/pull (streaming proxy), with Ollama faked
// through an injected fetch.

function setup(fetchFn: (url: string, init?: RequestInit) => Promise<Response>) {
  const dataDir = mkdtempSync(join(tmpdir(), "knowhive-oroutes-"));
  const config = loadConfig(dataDir);
  const app = new Hono().route("/", ollamaRoutes({ getConfig: () => config, fetchFn }));
  return { app };
}

test("GET /ollama/status reports running + models when Ollama responds", async () => {
  const { app } = setup(async (url) => {
    expect(url).toBe("http://localhost:11434/api/tags");
    return new Response(JSON.stringify({ models: [{ name: "llama3.2:latest" }] }), { status: 200 });
  });
  const res = await app.request("/ollama/status");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.running).toBe(true);
  expect(body.models).toEqual(["llama3.2:latest"]);
  expect(body.required[0]).toEqual({ name: "llama3.2", purpose: "chat", installed: true });
});

test("GET /ollama/status reports running:false when Ollama is unreachable", async () => {
  const { app } = setup(async () => {
    throw new TypeError("Unable to connect");
  });
  const res = await app.request("/ollama/status");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.running).toBe(false);
  expect(body.models).toEqual([]);
  expect(body.required.every((r: { installed: boolean }) => !r.installed)).toBe(true);
});

test("GET /ollama/context reports the chat model's context window", async () => {
  const { app } = setup(async (url, init) => {
    expect(url).toBe("http://localhost:11434/api/show");
    expect(JSON.parse(init!.body as string).model).toBe("llama3.2");
    return new Response(
      JSON.stringify({
        model_info: { "llama.context_length": 131072, "llama.block_count": 28 },
      }),
      { status: 200 },
    );
  });
  const res = await app.request("/ollama/context");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.model).toBe("llama3.2");
  expect(body.context_length).toBe(131072);
});

test("GET /ollama/context degrades to null when Ollama is unreachable", async () => {
  const { app } = setup(async () => {
    throw new TypeError("Unable to connect");
  });
  const res = await app.request("/ollama/context");
  expect(res.status).toBe(200);
  expect((await res.json()).context_length).toBeNull();
});

test("POST /ollama/pull streams the upstream NDJSON progress through", async () => {
  const upstream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"status":"pulling manifest"}\n'));
      controller.enqueue(
        new TextEncoder().encode('{"status":"downloading","total":100,"completed":50}\n'),
      );
      controller.enqueue(new TextEncoder().encode('{"status":"success"}\n'));
      controller.close();
    },
  });
  const { app } = setup(async (url, init) => {
    expect(url).toBe("http://localhost:11434/api/pull");
    expect(JSON.parse(init!.body as string)).toEqual({ model: "bge-m3", stream: true });
    return new Response(upstream, { status: 200 });
  });

  const res = await app.request("/ollama/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "bge-m3" }),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toContain("application/x-ndjson");
  const lines = (await res.text()).trim().split("\n");
  expect(lines.length).toBe(3);
  expect(JSON.parse(lines[1]!)).toEqual({ status: "downloading", total: 100, completed: 50 });
});

test("POST /ollama/pull surfaces upstream errors", async () => {
  const { app } = setup(async () => new Response("model not found", { status: 404 }));
  const res = await app.request("/ollama/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "ghost-model" }),
  });
  expect(res.status).toBe(404);
});

test("POST /ollama/pull rejects a missing model name with 422", async () => {
  const { app } = setup(async () => new Response("{}", { status: 200 }));
  const res = await app.request("/ollama/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(422);
});
