// Ingestion pipeline: parse frontmatter → heading-aware chunk → embed → store (chunks +
// vectors + FTS) → record the document. Ported from backend/app/services/ingest_service.py.
// The embedder is injected so the pipeline is unit-testable without Ollama.
import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import { parseFrontmatter } from "./frontmatter.ts";
import { splitByHeadings } from "./chunker.ts";
import { deleteChunksForFile, storeChunks } from "./store.ts";

export type Embedder = (texts: string[]) => Promise<number[][]>;

export interface IngestResult {
  filePath: string;
  chunkCount: number;
}

/** Ingest raw Markdown text under `filePath`. Re-ingest is idempotent (old chunks dropped). */
export async function ingestText(
  db: Database,
  filePath: string,
  rawText: string,
  embed: Embedder,
): Promise<IngestResult> {
  const { data, body } = parseFrontmatter(rawText);
  const chunks = splitByHeadings(body);

  if (chunks.length === 0) {
    deleteChunksForFile(db, filePath);
    upsertDocument(db, filePath, data.title, 0, "empty");
    return { filePath, chunkCount: 0 };
  }

  const embeddings = await embed(chunks.map((c) => c.content));
  deleteChunksForFile(db, filePath);
  storeChunks(db, filePath, chunks, embeddings, data);
  upsertDocument(db, filePath, data.title, chunks.length, "indexed");

  return { filePath, chunkCount: chunks.length };
}

function upsertDocument(
  db: Database,
  filePath: string,
  title: string | null,
  chunkCount: number,
  status: string,
): void {
  db.run(
    `INSERT INTO documents (file_path, file_name, modified_at, indexed_at, chunk_count, status, title)
       VALUES (?, ?, datetime('now'), datetime('now'), ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       indexed_at  = datetime('now'),
       chunk_count = excluded.chunk_count,
       status      = excluded.status,
       title       = excluded.title,
       updated_at  = datetime('now')`,
    [filePath, basename(filePath), chunkCount, status, title],
  );
}
