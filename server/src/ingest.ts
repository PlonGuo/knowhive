// Ingestion pipeline: parse frontmatter → heading-aware chunk → embed → store (chunks +
// vectors + FTS) → record the document. Ported from backend/app/services/ingest_service.py.
// The embedder is injected so the pipeline is unit-testable without Ollama.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
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

/** Recursively list .md files under `directory` (absolute paths, sorted).
 * Mirrors ingest_service.find_ingestable_files; PDF support is not ported to the TS stack yet. */
export async function findMarkdownFiles(directory: string): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const glob = new Bun.Glob("**/*.md");
  const relPaths = (await Array.fromAsync(glob.scan({ cwd: directory }))).sort();
  return relPaths.map((rel) => join(directory, rel));
}

/** Recursively ingest all .md files under `directory` (used by re-embed and resync).
 * Mirrors ingest_service.ingest_directory. */
export async function ingestDirectory(
  db: Database,
  directory: string,
  embed: Embedder,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const path of await findMarkdownFiles(directory)) {
    results.push(await ingestText(db, path, readFileSync(path, "utf8"), embed));
  }
  return results;
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
