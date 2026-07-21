// Vector retrieval primitives. Deliberately hand-rolled brute-force KNN:
// at personal-KB scale (thousands of chunks) an exact cosine scan is sub-millisecond,
// zero native dependencies, and keeps everything in one SQLite file. This module is the
// swap point — a future LanceDB/sqlite-vec/Orama backend implements the same interface.

/** Little-endian float32 BLOB for storing an embedding in a SQLite column. */
export function encodeVector(v: readonly number[] | Float32Array): Uint8Array {
  return new Uint8Array(Float32Array.from(v).buffer);
}

/** Decode a float32 BLOB back into a vector. Copies so we don't alias a pooled buffer. */
export function decodeVector(buf: Uint8Array): Float32Array {
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer);
}

/** Cosine similarity in [-1, 1]. Returns 0 if either vector is all-zero. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSimilarity: dimension mismatch ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface Candidate {
  id: number;
  vector: ArrayLike<number>;
}

export interface Scored {
  id: number;
  score: number;
}

/** Exact top-k nearest neighbours by cosine similarity (descending). */
export function knn(query: ArrayLike<number>, candidates: readonly Candidate[], k: number): Scored[] {
  const scored: Scored[] = candidates.map((c) => ({
    id: c.id,
    score: cosineSimilarity(query, c.vector),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

// --- Swap point for scaling ------------------------------------------------
// Retrieval is programmed to this interface so the backend can change without
// touching callers. Vectors live in SQLite (source of truth), so the index is a
// derived, rebuildable artifact: switching to an ANN backend (hnswlib-node / LanceDB)
// means implementing VectorIndex + rebuilding from stored vectors — no data migration,
// no API change. We ship only the exact backend now (YAGNI); ANN is added at scale.

export interface VectorIndex {
  /** Return the top-k most similar stored vectors to `query`. */
  search(query: ArrayLike<number>, k: number): Scored[];
}

/**
 * Exact brute-force KNN over a lazily-provided candidate set. Correct and sub-millisecond
 * at personal-KB scale; O(n) — swap for an ANN index past ~100k vectors.
 */
export class BruteForceIndex implements VectorIndex {
  constructor(private readonly candidates: () => Iterable<Candidate>) {}

  search(query: ArrayLike<number>, k: number): Scored[] {
    return knn(query, [...this.candidates()], k);
  }
}
