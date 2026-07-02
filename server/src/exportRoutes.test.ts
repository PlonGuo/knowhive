import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { unzipSync } from "fflate";
import { openDbAt } from "./db.ts";
import { exportRoutes } from "./exportRoutes.ts";

// Parity tests against backend/app/routers/export.py endpoints.

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "knowhive-eroutes-"));
  const knowledgeDir = join(dataDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  writeFileSync(join(knowledgeDir, "a.md"), "# A");
  const configPath = join(dataDir, "config.yaml");
  writeFileSync(configPath, "x: 1\n");
  const db = openDbAt(":memory:");
  const app = new Hono().route("/", exportRoutes({ db, knowledgeDir, configPath }));
  return { app };
}

test("POST /export/full responds with a zip attachment", async () => {
  const { app } = setup();
  const res = await app.request("/export/full", { method: "POST" });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("application/zip");
  expect(res.headers.get("Content-Disposition")).toContain('attachment; filename="knowhive-export-');
  const entries = unzipSync(new Uint8Array(await res.arrayBuffer()));
  expect(Object.keys(entries)).toContain("knowledge/a.md");
});

test("POST /export/chat returns the chat history as JSON", async () => {
  const { app } = setup();
  const res = await app.request("/export/chat", { method: "POST" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("POST /export/file streams a single file and guards traversal", async () => {
  const { app } = setup();
  const ok = await app.request("/export/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "a.md" }),
  });
  expect(ok.status).toBe(200);
  expect(await ok.text()).toBe("# A");
  expect(ok.headers.get("Content-Disposition")).toBe('attachment; filename="a.md"');

  const traversal = await app.request("/export/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "../config.yaml" }),
  });
  expect(traversal.status).toBe(400);

  const missing = await app.request("/export/file", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "ghost.md" }),
  });
  expect(missing.status).toBe(404);
});
