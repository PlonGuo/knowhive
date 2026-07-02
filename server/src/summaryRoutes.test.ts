import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDbAt } from "./db.ts";
import { storeSummary } from "./summary.ts";
import { summaryRoutes } from "./summaryRoutes.ts";

// Parity tests against backend/app/routers/summary.py endpoints.

function setup() {
  const knowledgeDir = mkdtempSync(join(tmpdir(), "knowhive-sroutes-"));
  const db = openDbAt(":memory:");
  const app = new Hono().route(
    "/",
    summaryRoutes({ db, knowledgeDir, generate: async (_c, fp) => `gen:${fp}` }),
  );
  return { app, db, knowledgeDir };
}

test("GET /summary/file returns the cached summary or 404", async () => {
  const { app, db } = setup();
  storeSummary(db, "a.md", "cached a");
  const hit = await app.request("/summary/file?file_path=a.md");
  expect(hit.status).toBe(200);
  expect(await hit.json()).toEqual({ file_path: "a.md", summary: "cached a", cached: true });
  expect((await app.request("/summary/file?file_path=miss.md")).status).toBe(404);
});

test("POST /summary/cached returns only already-cached entries (no LLM)", async () => {
  const { app, db } = setup();
  storeSummary(db, "a.md", "cached a");
  const res = await app.request("/summary/cached", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_paths: ["a.md", "b.md"] }),
  });
  expect(await res.json()).toEqual([{ file_path: "a.md", summary: "cached a" }]);
});

test("POST /summary/generate creates and caches a summary, 404s on missing files", async () => {
  const { app, db, knowledgeDir } = setup();
  writeFileSync(join(knowledgeDir, "b.md"), "# B");
  const res = await app.request("/summary/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: "b.md" }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ file_path: "b.md", summary: "gen:b.md" });

  const missing = await app.request("/summary/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: "ghost.md" }),
  });
  expect(missing.status).toBe(404);
});

test("POST /summary/batch generates for existing files and skips missing ones", async () => {
  const { app, knowledgeDir } = setup();
  writeFileSync(join(knowledgeDir, "x.md"), "# X");
  writeFileSync(join(knowledgeDir, "y.md"), "# Y");
  const res = await app.request("/summary/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_paths: ["x.md", "ghost.md", "y.md"] }),
  });
  expect(await res.json()).toEqual([
    { file_path: "x.md", summary: "gen:x.md" },
    { file_path: "y.md", summary: "gen:y.md" },
  ]);
});
