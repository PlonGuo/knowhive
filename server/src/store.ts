// SQLite persistence for chunks + hybrid retrieval. Vectors are stored as float32 BLOBs
// (source of truth); FTS5 mirror is kept in sync by triggers (see db.ts). Retrieval fuses
// brute-force vector KNN with FTS5 keyword hits via RRF.
import type { Database } from "bun:sqlite";
import type { ChunkedDocument } from "./chunker.ts";
import type { FrontmatterData } from "./frontmatter.ts";
import { BruteForceIndex, decodeVector, encodeVector, type Candidate } from "./retrieval.ts";
import { rrfFuse } from "./hybrid.ts";

export interface ChunkRow {
  id: number;
  file_path: string;
  chunk_index: number;
  content: string;
  section_heading: string | null;
  /** Row in parent_chunks this child was split from; NULL for pre-parent-child data. */
  parent_id: number | null;
  title: string | null;
  category: string | null;
  tags: string | null;
  difficulty: string | null;
  pack_id: string | null;
}

export function deleteChunksForFile(db: Database, filePath: string): void {
  db.run("DELETE FROM chunks WHERE file_path = ?", [filePath]);
  db.run("DELETE FROM parent_chunks WHERE file_path = ?", [filePath]);
}

/** Point a file's chunks at its new path after a rename (embeddings stay valid). */
export function renameChunksFilePath(db: Database, oldPath: string, newPath: string): void {
  db.run("UPDATE chunks SET file_path = ? WHERE file_path = ?", [newPath, oldPath]);
  db.run("UPDATE parent_chunks SET file_path = ? WHERE file_path = ?", [newPath, oldPath]);
}

/**
 * Insert a file's parent + child chunks in one transaction. `embeddings` are the child
 * vectors, in `doc.children` order — parents are never embedded.
 */
export function storeChunks(
  db: Database,
  filePath: string,
  doc: ChunkedDocument,
  embeddings: readonly number[][],
  meta: FrontmatterData,
): void {
  const insertParent = db.prepare(
    `INSERT INTO parent_chunks (file_path, parent_index, content, section_heading)
     VALUES (?, ?, ?, ?)`,
  );
  const insertChild = db.prepare(
    `INSERT INTO chunks
       (file_path, chunk_index, content, section_heading, parent_id, embedding, title, category, tags, difficulty, pack_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tags = meta.tags.length > 0 ? meta.tags.join(",") : null;

  const tx = db.transaction(() => {
    // parent_index → the rowid it landed on, so children can point at it.
    const parentRowIds = new Map<number, number>();
    for (const p of doc.parents) {
      insertParent.run(filePath, p.parent_index, p.content, p.section_heading || null);
      parentRowIds.set(
        p.parent_index,
        Number((db.query("SELECT last_insert_rowid() AS id").get() as { id: number }).id),
      );
    }
    for (let i = 0; i < doc.children.length; i++) {
      const c = doc.children[i]!;
      insertChild.run(
        filePath,
        c.chunk_index,
        c.content,
        c.section_heading || null,
        parentRowIds.get(c.parent_index) ?? null,
        encodeVector(embeddings[i]!),
        meta.title,
        meta.category,
        tags,
        meta.difficulty,
        meta.pack_id,
      );
    }
  });
  tx();
}

/** All stored chunk vectors as KNN candidates (the brute-force index's data source). */
export function allChunkCandidates(db: Database): Candidate[] {
  const rows = db
    .query("SELECT id, embedding FROM chunks WHERE embedding IS NOT NULL")
    .all() as { id: number; embedding: Uint8Array }[];
  return rows.map((r) => ({ id: r.id, vector: decodeVector(r.embedding) }));
}

/** FTS5 keyword hits, best-first (lower bm25 = better). Returns ids in rank order. */
export function ftsSearch(db: Database, query: string, limit: number): number[] {
  const cleaned = query.trim();
  if (!cleaned) return [];
  try {
    const rows = db
      .query(
        `SELECT rowid AS id FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY bm25(chunks_fts) LIMIT ?`,
      )
      .all(cleaned, limit) as { id: number }[];
    return rows.map((r) => r.id);
  } catch {
    // Arbitrary user text can be invalid FTS5 syntax — treat as no keyword hits.
    return [];
  }
}

const CHUNK_COLUMNS =
  "id, file_path, chunk_index, content, section_heading, parent_id, title, category, tags, difficulty, pack_id";

/**
 * Swap each matched child for the parent passage it came from ("small-to-big").
 *
 * Ranking already happened on the child text, which is the precise thing the question
 * matched; this only changes what the model gets to read. Children sharing a parent
 * collapse into one row — the highest-ranked one keeps the slot — so expansion never
 * feeds the same passage twice. Rows with no parent (pre-migration chunks) pass through.
 */
export function expandToParents(db: Database, rows: readonly ChunkRow[]): ChunkRow[] {
  const parentIds = [...new Set(rows.map((r) => r.parent_id).filter((id): id is number => id !== null))];
  if (parentIds.length === 0) return [...rows];

  const placeholders = parentIds.map(() => "?").join(",");
  const parents = db
    .query(`SELECT id, content FROM parent_chunks WHERE id IN (${placeholders})`)
    .all(...parentIds) as { id: number; content: string }[];
  const contentById = new Map(parents.map((p) => [p.id, p.content]));

  const seen = new Set<number>();
  const out: ChunkRow[] = [];
  for (const row of rows) {
    if (row.parent_id === null) {
      out.push(row);
      continue;
    }
    if (seen.has(row.parent_id)) continue;
    seen.add(row.parent_id);
    const content = contentById.get(row.parent_id);
    out.push(content ? { ...row, content } : row);
  }
  return out;
}

function getChunksByIds(db: Database, ids: readonly number[]): ChunkRow[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .query(`SELECT ${CHUNK_COLUMNS} FROM chunks WHERE id IN (${placeholders})`)
    .all(...ids) as ChunkRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is ChunkRow => r !== undefined);
}

/** Hybrid retrieval: brute-force vector KNN ⊕ FTS5 keyword, fused with RRF. */
export function hybridSearch(
  db: Database,
  queryVector: readonly number[],
  queryText: string,
  k: number,
): ChunkRow[] {
  const pool = k * 2;
  const index = new BruteForceIndex(() => allChunkCandidates(db));
  const vecIds = index.search(queryVector, pool).map((s) => s.id);
  const ftsIds = ftsSearch(db, queryText, pool);
  const fused = rrfFuse([vecIds, ftsIds]).slice(0, k);
  return getChunksByIds(db, fused);
}
