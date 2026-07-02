// Reciprocal Rank Fusion (RRF): merge several ranked id-lists into one ranking.
// score(id) = Σ 1/(k + rank_in_list). Simple, tuning-free, and the standard way to
// combine vector (semantic) and FTS (keyword) results into hybrid search.

const DEFAULT_K = 60;

/** Fuse ranked lists (each best-first) into one id ranking, best-first. */
export function rrfFuse(lists: readonly (readonly number[])[], k: number = DEFAULT_K): number[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    list.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}
