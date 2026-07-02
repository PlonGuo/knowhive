// SQLite persistence for chunks + hybrid retrieval. Vectors are stored as float32 BLOBs
// (source of truth); FTS5 mirror is kept in sync by triggers (see db.ts). Retrieval fuses
// brute-force vector KNN with FTS5 keyword hits via RRF.
import type { Database } from "bun:sqlite";
import type { Chunk } from "./chunker.ts";
import type { FrontmatterData } from "./frontmatter.ts";
import { BruteForceIndex, decodeVector, encodeVector, type Candidate } from "./retrieval.ts";
import { rrfFuse } from "./hybrid.ts";

export interface ChunkRow {
  id: number;
  file_path: string;
  chunk_index: number;
  content: string;
  section_heading: string | null;
  title: string | null;
  category: string | null;
  tags: string | null;
  difficulty: string | null;
  pack_id: string | null;
}

export function deleteChunksForFile(db: Database, filePath: string): void {
  db.run("DELETE FROM chunks WHERE file_path = ?", [filePath]);
}

/** Insert chunks + their embeddings for a file, in one transaction. */
export function storeChunks(
  db: Database,
  filePath: string,
  chunks: readonly Chunk[],
  embeddings: readonly number[][],
  meta: FrontmatterData,
): void {
  const insert = db.prepare(
    `INSERT INTO chunks
       (file_path, chunk_index, content, section_heading, embedding, title, category, tags, difficulty, pack_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tags = meta.tags.length > 0 ? meta.tags.join(",") : null;
  const tx = db.transaction(() => {
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i]!;
      insert.run(
        filePath,
        c.chunk_index,
        c.content,
        c.section_heading || null,
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
  "id, file_path, chunk_index, content, section_heading, title, category, tags, difficulty, pack_id";

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
