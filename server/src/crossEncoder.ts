// Cross-encoder reranker (Phase E2): scores each (query, passage) pair with an ONNX
// cross-encoder and sorts by relevance. The scorer is injected so this pure logic is
// testable without the 571MB model. Fails open to input order on any error.
//
// It also carries the abstention gate. Retrieval used to return top-k unconditionally,
// so a question the corpus cannot answer still arrived at the model wrapped in
// <retrieved_context> — worse than no context, because the model reads a well-formed
// context block as a promise that the answer is in there. The scores needed to detect
// that were already computed here and thrown away.

export type CrossEncoderScorer = (query: string, passages: string[]) => Promise<number[]>;

/**
 * Abstain when the best candidate scores below this.
 *
 * Calibrated on a 28-answerable / 22-unanswerable question set over eval-corpus/md
 * (495 chunks, bge-m3, bge-reranker-v2-m3 int8) — backend/eval_results/abstain_spike.json,
 * write-up in learnings/career/09-工程改进实战记录.md §16. Measured separation:
 *
 *   bucket    n    p25     median   p75
 *   answerable 28   0.539   2.332    4.577
 *   near-miss  13  -4.305  -3.769   -2.218   (topic in corpus, answer absent)
 *   off-topic   9  -7.106  -6.109   -4.680
 *
 * At -2 the sweep costs 1/28 false abstentions (4%) and catches 19/22 unanswerable
 * questions (86%; 10/13 of the hard near-miss bucket, 9/9 off-topic). -2 is the knee:
 * moving to -1.4 doubles false abstentions for +5pp catch.
 *
 * MODEL-SPECIFIC. These are raw logits from one reranker at one quantization — swapping
 * either invalidates the number. Recalibrate with server/spike-abstain.ts.
 */
export const DEFAULT_RELEVANCE_FLOOR = -2;

/**
 * Resolve the floor from KNOWHIVE_RELEVANCE_FLOOR. "off" disables the gate entirely so
 * the A/B can run both arms on one build — the same switch shape as
 * KNOWHIVE_RERANK_STYLE and KNOWHIVE_FTS_TOKENIZER. Unparseable input falls back to the
 * calibrated default rather than silently disabling a safety behavior.
 */
export function relevanceFloor(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return DEFAULT_RELEVANCE_FLOOR;
  if (raw.toLowerCase() === "off") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_RELEVANCE_FLOOR;
}

export async function rerankCrossEncoder<T extends { content: string }>(
  query: string,
  chunks: T[],
  k: number,
  score: CrossEncoderScorer,
  floor: number | null = null,
): Promise<T[]> {
  if (chunks.length <= 1) return chunks.slice(0, k);
  try {
    const scores = await score(query, chunks.map((c) => c.content));
    if (scores.length !== chunks.length) return chunks.slice(0, k);
    const ranked = chunks
      .map((c, i) => ({ c, s: scores[i]! }))
      .sort((a, b) => b.s - a.s);
    // Gate on the best score only: the question is "did retrieval find anything at
    // all", not "is every chunk good". A weak tail behind a strong hit is normal and
    // the k cutoff already handles it.
    if (floor !== null && ranked[0]!.s < floor) return [];
    return ranked.slice(0, k).map((x) => x.c);
  } catch (err) {
    // Fail OPEN, never closed: a dead reranker must degrade to hybrid order, not to a
    // wrongful "I don't know" — abstention is a claim about the corpus, and a crashed
    // model is not evidence about the corpus.
    console.error("[crossEncoder] rerank failed, falling back to hybrid order:", err);
    return chunks.slice(0, k);
  }
}
