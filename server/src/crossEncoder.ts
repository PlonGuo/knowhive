// Cross-encoder reranker (Phase E2): scores each (query, passage) pair with an ONNX
// cross-encoder and sorts by relevance. The scorer is injected so this pure logic is
// testable without the 571MB model. Fails open to input order on any error.

export type CrossEncoderScorer = (query: string, passages: string[]) => Promise<number[]>;

export async function rerankCrossEncoder<T extends { content: string }>(
  query: string,
  chunks: T[],
  k: number,
  score: CrossEncoderScorer,
): Promise<T[]> {
  if (chunks.length <= 1) return chunks.slice(0, k);
  try {
    const scores = await score(query, chunks.map((c) => c.content));
    if (scores.length !== chunks.length) return chunks.slice(0, k);
    return chunks
      .map((c, i) => ({ c, s: scores[i]! }))
      .sort((a, b) => b.s - a.s)
      .slice(0, k)
      .map((x) => x.c);
  } catch (err) {
    console.error("[crossEncoder] rerank failed, falling back to hybrid order:", err);
    return chunks.slice(0, k);
  }
}
