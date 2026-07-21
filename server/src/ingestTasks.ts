// Ingest task tracking over the ingest_tasks table.
// Ports the task lifecycle from backend/app/routers/ingest.py (_run_ingest_task).
import type { Database } from "bun:sqlite";

export interface IngestTaskStatus {
  task_id: string;
  status: string;
  total_files: number;
  processed_files: number;
  errors: string | null;
}

export function createIngestTask(db: Database, taskId: string, totalFiles: number): void {
  db.run("INSERT INTO ingest_tasks (id, status, total_files) VALUES (?, 'pending', ?)", [
    taskId,
    totalFiles,
  ]);
}

export function getIngestTask(db: Database, taskId: string): IngestTaskStatus | null {
  const row = db
    .query("SELECT id, status, total_files, processed_files, errors FROM ingest_tasks WHERE id = ?")
    .get(taskId) as
    | { id: string; status: string; total_files: number; processed_files: number; errors: string | null }
    | null;
  if (!row) return null;
  return {
    task_id: row.id,
    status: row.status,
    total_files: row.total_files,
    processed_files: row.processed_files,
    errors: row.errors,
  };
}

/** Run ingestion for a list of files, updating the task row after each file so a
 * polling client sees live progress. Per-file failures are collected, not fatal. */
export async function runIngestTask(
  db: Database,
  taskId: string,
  paths: string[],
  ingestOne: (path: string) => Promise<void>,
): Promise<void> {
  db.run("UPDATE ingest_tasks SET status = 'running' WHERE id = ?", [taskId]);

  const errors: string[] = [];
  let processed = 0;
  for (const path of paths) {
    try {
      await ingestOne(path);
    } catch (err) {
      errors.push(`${path}: ${(err as Error).message}`);
    }
    processed++;
    db.run("UPDATE ingest_tasks SET processed_files = ? WHERE id = ?", [processed, taskId]);
  }

  db.run(
    `UPDATE ingest_tasks
     SET status = ?, processed_files = ?, errors = ?, completed_at = datetime('now')
     WHERE id = ?`,
    [errors.length > 0 ? "failed" : "completed", processed, errors.join("\n") || null, taskId],
  );
}
