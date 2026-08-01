import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { openDbAt } from "./db.ts";
import { ingestRoutes } from "./ingestRoutes.ts";
import { getIngestTask } from "./ingestTasks.ts";
import { findIngestableFiles } from "./ingest.ts";

// Parity tests against backend/app/routers/ingest.py endpoints. The ingest itself is
// injected so these run without Ollama.

function setup() {
  const knowledgeDir = mkdtempSync(join(tmpdir(), "knowhive-iroutes-"));
  const db = openDbAt(":memory:");
  const ingested: string[] = [];
  const app = new Hono().route(
    "/",
    ingestRoutes({
      db,
      knowledgeDir,
      ingestFile: async (absPath) => {
        if (absPath.includes("bad")) throw new Error("unreadable");
        ingested.push(absPath);
      },
    }),
  );
  return { app, knowledgeDir, db, ingested };
}

async function waitForTask(db: ReturnType<typeof openDbAt>, taskId: string) {
  for (let i = 0; i < 50; i++) {
    const task = getIngestTask(db, taskId);
    if (task && (task.status === "completed" || task.status === "failed")) return task;
    await Bun.sleep(10);
  }
  throw new Error("task did not finish");
}

test("POST /ingest/files accepts file_paths and returns a trackable task", async () => {
  const { app, db, ingested } = setup();
  const res = await app.request("/ingest/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_paths: ["/kb/a.md", "/kb/b.md"] }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("accepted");
  expect(body.total_files).toBe(2);

  const task = await waitForTask(db, body.task_id);
  expect(task.status).toBe("completed");
  expect(task.processed_files).toBe(2);
  expect(ingested).toEqual(["/kb/a.md", "/kb/b.md"]);
});

test("POST /ingest/files with an empty list returns 422 (FastAPI validator parity)", async () => {
  const { app } = setup();
  const res = await app.request("/ingest/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_paths: [] }),
  });
  expect(res.status).toBe(422);
});

test("GET /ingest/status/:taskId returns task state and 404s on unknown ids", async () => {
  const { app, db } = setup();
  const start = await app.request("/ingest/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_paths: ["/kb/bad.md"] }),
  });
  const { task_id } = await start.json();
  await waitForTask(db, task_id);

  const res = await app.request(`/ingest/status/${task_id}`);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({
    task_id,
    status: "failed",
    total_files: 1,
    processed_files: 1,
    errors: "/kb/bad.md: unreadable",
  });

  expect((await app.request("/ingest/status/ghost")).status).toBe(404);
});

test("POST /ingest/resync re-ingests all .md files under the knowledge dir", async () => {
  const { app, db, knowledgeDir, ingested } = setup();
  writeFileSync(join(knowledgeDir, "a.md"), "# a");
  mkdirSync(join(knowledgeDir, "sub"));
  writeFileSync(join(knowledgeDir, "sub", "b.md"), "# b");
  writeFileSync(join(knowledgeDir, "skip.png"), "no");

  const res = await app.request("/ingest/resync", { method: "POST" });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.status).toBe("accepted");
  expect(body.total_files).toBe(2);

  const task = await waitForTask(db, body.task_id);
  expect(task.status).toBe("completed");
  expect(ingested.sort()).toEqual([join(knowledgeDir, "a.md"), join(knowledgeDir, "sub", "b.md")]);
});

test("resync includes PDFs when the injected lister provides them, and afterTask fires", async () => {
  const knowledgeDir = mkdtempSync(join(tmpdir(), "knowhive-iroutes-pdf-"));
  writeFileSync(join(knowledgeDir, "a.md"), "# a");
  writeFileSync(join(knowledgeDir, "doc.pdf"), "%PDF-fake");
  const db = openDbAt(":memory:");
  const ingested: string[] = [];
  let afterTaskCalls = 0;
  const app = new Hono().route(
    "/",
    ingestRoutes({
      db,
      knowledgeDir,
      ingestFile: async (p) => {
        ingested.push(p);
      },
      listFiles: (dir) => findIngestableFiles(dir, { includePdf: true }),
      afterTask: () => {
        afterTaskCalls++;
      },
    }),
  );

  const res = await app.request("/ingest/resync", { method: "POST" });
  const body = await res.json();
  expect(body.total_files).toBe(2);
  const task = await waitForTask(db, body.task_id);
  expect(task.status).toBe("completed");
  expect(ingested.some((p) => p.endsWith("doc.pdf"))).toBe(true);
  expect(afterTaskCalls).toBe(1);
});
