// Ingest endpoints: POST /ingest/files, GET /ingest/status/:taskId, POST /ingest/resync.
// Ports backend/app/routers/ingest.py. Unlike the Python version (which ran the task
// before responding), the task runs in the background so the frontend's polling
// actually observes processed_files advance.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { findMarkdownFiles } from "./ingest.ts";
import { createIngestTask, getIngestTask, runIngestTask } from "./ingestTasks.ts";

export interface IngestRoutesDeps {
  db: Database;
  knowledgeDir: string;
  /** Ingest a single file (wired to readFileSync + ingestText + live embedder). */
  ingestFile: (absPath: string) => Promise<void>;
}

export function ingestRoutes(deps: IngestRoutesDeps): Hono {
  const app = new Hono();

  const startTask = (paths: string[]) => {
    const taskId = crypto.randomUUID();
    createIngestTask(deps.db, taskId, paths.length);
    runIngestTask(deps.db, taskId, paths, deps.ingestFile).catch((err) => {
      console.error(`[ingest] task ${taskId} crashed:`, err);
    });
    return taskId;
  };

  app.post("/ingest/files", async (c) => {
    const { file_paths } = (await c.req.json()) as { file_paths?: string[] };
    if (!Array.isArray(file_paths) || file_paths.length === 0) {
      return c.json({ detail: "file_paths must not be empty" }, 422);
    }
    const taskId = startTask(file_paths);
    return c.json({ task_id: taskId, status: "accepted", total_files: file_paths.length });
  });

  app.get("/ingest/status/:taskId", (c) => {
    const task = getIngestTask(deps.db, c.req.param("taskId"));
    if (!task) return c.json({ detail: "Task not found" }, 404);
    return c.json(task);
  });

  app.post("/ingest/resync", async (c) => {
    mkdirSync(deps.knowledgeDir, { recursive: true });
    const files = await findMarkdownFiles(deps.knowledgeDir);
    const taskId = startTask(files);
    return c.json({ task_id: taskId, status: "accepted", total_files: files.length });
  });

  return app;
}
