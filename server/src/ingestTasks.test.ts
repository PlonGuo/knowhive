import { test, expect } from "bun:test";
import { openDbAt } from "./db.ts";
import { createIngestTask, getIngestTask, runIngestTask } from "./ingestTasks.ts";

// Parity tests against backend/app/routers/ingest.py task lifecycle
// (pending → running → completed/failed, per-file error collection).

test("createIngestTask + getIngestTask round-trips a pending task", () => {
  const db = openDbAt(":memory:");
  createIngestTask(db, "t1", 3);
  expect(getIngestTask(db, "t1")).toEqual({
    task_id: "t1",
    status: "pending",
    total_files: 3,
    processed_files: 0,
    errors: null,
  });
});

test("getIngestTask returns null for an unknown task", () => {
  const db = openDbAt(":memory:");
  expect(getIngestTask(db, "ghost")).toBeNull();
});

test("runIngestTask processes all files and marks the task completed", async () => {
  const db = openDbAt(":memory:");
  createIngestTask(db, "t1", 2);
  const seen: string[] = [];
  await runIngestTask(db, "t1", ["a.md", "b.md"], async (p) => {
    seen.push(p);
  });
  expect(seen).toEqual(["a.md", "b.md"]);
  const task = getIngestTask(db, "t1")!;
  expect(task.status).toBe("completed");
  expect(task.processed_files).toBe(2);
  expect(task.errors).toBeNull();
});

test("runIngestTask updates processed_files after each file (live progress)", async () => {
  const db = openDbAt(":memory:");
  createIngestTask(db, "t1", 2);
  const progress: number[] = [];
  await runIngestTask(db, "t1", ["a.md", "b.md"], async () => {
    progress.push(getIngestTask(db, "t1")!.processed_files);
  });
  // Each call observes the count from before its own completion.
  expect(progress).toEqual([0, 1]);
  expect(getIngestTask(db, "t1")!.status).toBe("completed");
});

test("runIngestTask records per-file errors, continues, and marks the task failed", async () => {
  const db = openDbAt(":memory:");
  createIngestTask(db, "t1", 3);
  const seen: string[] = [];
  await runIngestTask(db, "t1", ["a.md", "bad.md", "c.md"], async (p) => {
    if (p === "bad.md") throw new Error("boom");
    seen.push(p);
  });
  expect(seen).toEqual(["a.md", "c.md"]);
  const task = getIngestTask(db, "t1")!;
  expect(task.status).toBe("failed");
  expect(task.processed_files).toBe(3);
  expect(task.errors).toBe("bad.md: boom");
});
