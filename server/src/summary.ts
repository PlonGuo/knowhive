// LLM document summaries with DB caching (summaries table).
// Ports backend/app/services/summary_service.py. The LLM call is injected.
import type { Database } from "bun:sqlite";
import { resolveSafePath } from "./knowledge.ts";

export const SUMMARIZE_SYSTEM_PROMPT =
  "You are a concise technical summarizer. " +
  "Summarize the provided document content in 2-4 sentences, " +
  "capturing the main topics and key points.";

export type SummaryGenerator = (content: string, filePath: string) => Promise<string>;

export function getCachedSummary(db: Database, filePath: string): string | null {
  const row = db.query("SELECT summary FROM summaries WHERE file_path = ?").get(filePath) as {
    summary: string;
  } | null;
  return row?.summary ?? null;
}

export function storeSummary(db: Database, filePath: string, summary: string): void {
  db.run(
    `INSERT INTO summaries (file_path, summary, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(file_path) DO UPDATE SET
       summary = excluded.summary,
       updated_at = datetime('now')`,
    [filePath, summary],
  );
}

/** Return cached summary or generate + cache one. Returns null if the file is missing.
 * `filePath` is relative to the knowledge dir (tree paths from the frontend). */
export async function getOrGenerate(
  db: Database,
  filePath: string,
  knowledgeDir: string,
  generate: SummaryGenerator,
): Promise<string | null> {
  const cached = getCachedSummary(db, filePath);
  if (cached !== null) return cached;

  const target = resolveSafePath(knowledgeDir, filePath);
  const file = Bun.file(target);
  if (!(await file.exists())) return null;

  const summary = await generate(await file.text(), filePath);
  storeSummary(db, filePath, summary);
  return summary;
}
