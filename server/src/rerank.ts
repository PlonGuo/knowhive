// LLM-as-reranker (Phase E, step 1): one listwise LLM call reranks hybrid-search
// candidates. Replaces the Python CrossEncoder for now (see the roadmap: a
// transformers.js cross-encoder spike is gated on this proving its value via RAGAS).
// The LLM call is injected; every failure mode fails open to the original order.

/** How many candidates hybrid search should over-fetch when reranking is on. */
export const RERANK_CANDIDATES = 20;

/** Per-chunk excerpt length in the prompt — bounds context for 20 candidates. */
const EXCERPT_CHARS = 1000;

export type RerankGenerator = (prompt: string) => Promise<string>;

/** "relevance" = plain listwise ranking; "coverage" = MMR-style diversity hint that
 * asks the model to cover different aspects of the query instead of stacking
 * redundant passages (experiment: k-sweep, see learnings/Reranker-K-Sweep.md). */
export type RerankPromptStyle = "relevance" | "coverage";

export function buildRerankPrompt(
  query: string,
  contents: string[],
  style: RerankPromptStyle = "relevance",
): string {
  const numbered = contents
    .map((c, i) => `[${i + 1}] ${c.length > EXCERPT_CHARS ? `${c.slice(0, EXCERPT_CHARS)}…` : c}`)
    .join("\n\n");
  const diversity =
    style === "coverage"
      ? " When several passages repeat the same information, prefer covering different aspects of the query over stacking near-duplicates."
      : "";
  return (
    `You are a search result reranker. Rank the following passages by relevance to the query, most relevant first.${diversity}\n\n` +
    `Query: ${query}\n\nPassages:\n${numbered}\n\n` +
    `Respond with ONLY a JSON array of passage numbers, most relevant first, e.g. [2, 1, 3]. No other text.`
  );
}

/** Extract a ranking (1-based indices) from LLM output. Invalid/duplicate indices are
 * dropped, missing ones appended in original order. Null if no array is found. */
export function parseRanking(raw: string, count: number): number[] | null {
  const match = raw.match(/\[[\d\s,]*\]/);
  if (!match) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;

  const seen = new Set<number>();
  const ranking: number[] = [];
  for (const v of parsed) {
    if (Number.isInteger(v) && v >= 1 && v <= count && !seen.has(v)) {
      seen.add(v);
      ranking.push(v);
    }
  }
  for (let i = 1; i <= count; i++) {
    if (!seen.has(i)) ranking.push(i);
  }
  return ranking;
}

export async function rerankChunks<T extends { content: string }>(
  query: string,
  chunks: T[],
  k: number,
  generate: RerankGenerator,
  style: RerankPromptStyle = "relevance",
): Promise<T[]> {
  if (chunks.length <= 1) return chunks.slice(0, k);

  try {
    const raw = await generate(buildRerankPrompt(query, chunks.map((c) => c.content), style));
    const ranking = parseRanking(raw, chunks.length);
    if (!ranking) return chunks.slice(0, k);
    return ranking.slice(0, k).map((i) => chunks[i - 1]!);
  } catch (err) {
    console.error("[rerank] LLM rerank failed, falling back to hybrid order:", err);
    return chunks.slice(0, k);
  }
}
