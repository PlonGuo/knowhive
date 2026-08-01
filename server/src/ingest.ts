// Ingestion pipeline: parse frontmatter → heading-aware chunk → embed → store (chunks +
// vectors + FTS) → record the document. Ported from backend/app/services/ingest_service.py.
// The embedder is injected so the pipeline is unit-testable without Ollama.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter, type FrontmatterData } from "./frontmatter.ts";
import { chunkDocument } from "./chunker.ts";
import { parseMarkdown } from "./markdownIr.ts";
import type { DocumentIR } from "./documentIr.ts";
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
  // Content hash + size let the sync service detect modified files (sync.ts).
  const fileHash = new Bun.CryptoHasher("sha256").update(rawText).digest("hex");
  const fileSize = Buffer.byteLength(rawText);
  // Markdown → DocumentIR; everything downstream of the IR is format-agnostic.
  return ingestParsed(db, filePath, parseMarkdown(body), data, fileHash, fileSize, embed);
}

/**
 * Ingest an already-parsed DocumentIR — the entry point for non-markdown formats
 * whose producer lives outside this process (the knowhive-pdf plugin emits IR
 * JSON over stdio). Hash/size describe the ORIGINAL file bytes so sync can
 * detect modifications the same way it does for markdown.
 */
export async function ingestIR(
  db: Database,
  filePath: string,
  ir: DocumentIR,
  fileHash: string,
  fileSize: number,
  embed: Embedder,
): Promise<IngestResult> {
  const noMeta: FrontmatterData = { title: null, category: null, tags: [], difficulty: null, pack_id: null };
  return ingestParsed(db, filePath, ir, noMeta, fileHash, fileSize, embed);
}

/** Shared tail of every ingest path: chunk → embed children → store → record. */
async function ingestParsed(
  db: Database,
  filePath: string,
  ir: DocumentIR,
  data: FrontmatterData,
  fileHash: string,
  fileSize: number,
  embed: Embedder,
): Promise<IngestResult> {
  const doc = chunkDocument(ir);

  if (doc.children.length === 0) {
    deleteChunksForFile(db, filePath);
    upsertDocument(db, filePath, data.title, 0, "empty", fileHash, fileSize, doc.strategy);
    return { filePath, chunkCount: 0 };
  }

  // Only children are embedded — parents exist to be read, not matched.
  const embeddings = await embed(doc.children.map((c) => c.content));
  deleteChunksForFile(db, filePath);
  storeChunks(db, filePath, doc, embeddings, data);
  upsertDocument(db, filePath, data.title, doc.children.length, "indexed", fileHash, fileSize, doc.strategy);

  return { filePath, chunkCount: doc.children.length };
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
  fileHash: string,
  fileSize: number,
  chunkStrategy: string,
): void {
  db.run(
    `INSERT INTO documents (file_path, file_name, file_hash, file_size, modified_at, indexed_at, chunk_count, status, title, chunk_strategy)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'), ?, ?, ?, ?)
     ON CONFLICT(file_path) DO UPDATE SET
       file_hash      = excluded.file_hash,
       file_size      = excluded.file_size,
       indexed_at     = datetime('now'),
       chunk_count    = excluded.chunk_count,
       status         = excluded.status,
       title          = excluded.title,
       chunk_strategy = excluded.chunk_strategy,
       updated_at     = datetime('now')`,
    [filePath, basename(filePath), fileHash, fileSize, chunkCount, status, title, chunkStrategy],
  );
}
