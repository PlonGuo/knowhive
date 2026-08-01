// Ingestion pipeline: parse frontmatter → heading-aware chunk → embed → store (chunks +
// vectors + FTS) → record the document. Ported from backend/app/services/ingest_service.py.
// The embedder is injected so the pipeline is unit-testable without Ollama.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter, type FrontmatterData } from "./frontmatter.ts";
import { chunkDocument } from "./chunker.ts";
import { parseMarkdown } from "./markdownIr.ts";
import { parseTxt } from "./txtIr.ts";
import { parseDocx } from "./docxIr.ts";
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

/** Recursively list locally-parseable files under `directory` (absolute paths, sorted). */
export async function findMarkdownFiles(directory: string): Promise<string[]> {
  return findIngestableFiles(directory, { includePdf: false });
}

/**
 * List ingestable files: local formats (md/txt/docx — parsed in-process) always,
 * PDFs only when the knowhive-pdf plugin is available (a PDF without the plugin
 * would just fail per-file).
 */
export async function findIngestableFiles(
  directory: string,
  opts: { includePdf: boolean },
): Promise<string[]> {
  if (!existsSync(directory)) return [];
  const glob = new Bun.Glob(opts.includePdf ? "**/*.{md,txt,docx,pdf}" : "**/*.{md,txt,docx}");
  const relPaths = (await Array.fromAsync(glob.scan({ cwd: directory }))).sort();
  return relPaths.map((rel) => join(directory, rel));
}

/**
 * Ingest any locally-parseable file by extension: md keeps its frontmatter
 * path, txt/docx go through their producers into ingestIR. PDF is NOT handled
 * here — it needs the external plugin (see index.ts's ingestOne).
 */
export async function ingestLocalFile(
  db: Database,
  absPath: string,
  embed: Embedder,
): Promise<IngestResult> {
  const lower = absPath.toLowerCase();
  if (lower.endsWith(".txt")) {
    const raw = readFileSync(absPath, "utf8");
    const fileHash = new Bun.CryptoHasher("sha256").update(raw).digest("hex");
    return ingestIR(db, absPath, parseTxt(raw), fileHash, Buffer.byteLength(raw), embed);
  }
  if (lower.endsWith(".docx")) {
    const bytes = readFileSync(absPath);
    const fileHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    return ingestIR(db, absPath, await parseDocx(bytes), fileHash, bytes.byteLength, embed);
  }
  return ingestText(db, absPath, readFileSync(absPath, "utf8"), embed);
}

/**
 * Record a file that could not be ingested (e.g. a scanned PDF with OCR off)
 * so the document list can show WHY instead of silently omitting it.
 */
export function markDocumentError(db: Database, filePath: string, message: string): void {
  db.run(
    `INSERT INTO documents (file_path, file_name, modified_at, chunk_count, status, error_message)
       VALUES (?, ?, datetime('now'), 0, 'error', ?)
     ON CONFLICT(file_path) DO UPDATE SET
       status        = 'error',
       error_message = excluded.error_message,
       chunk_count   = 0,
       updated_at    = datetime('now')`,
    [filePath, basename(filePath), message],
  );
}

/** Recursively ingest all locally-parseable files under `directory` (used by
 * re-embed and resync). PDF re-embedding requires the plugin and goes through
 * index.ts's ingestOne instead. */
export async function ingestDirectory(
  db: Database,
  directory: string,
  embed: Embedder,
): Promise<IngestResult[]> {
  const results: IngestResult[] = [];
  for (const path of await findMarkdownFiles(directory)) {
    results.push(await ingestLocalFile(db, path, embed));
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
