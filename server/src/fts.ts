// FTS5 tokenizer choice + query construction for the keyword leg of hybrid search.
//
// The table originally carried no `tokenize=` clause, so it used FTS5's default
// unicode61. unicode61 splits on Unicode category, and Han ideographs are letters,
// so an unspaced Chinese run indexes as ONE token — a Chinese query essentially
// never produced a BM25 hit and RRF quietly degraded to vector-only on Chinese
// content. (Measured: "哈希值" / "最短路径" / "完整哈希" all missed; "Dijkstra"
// and "SHA" hit. It also means the migration's context_recall 0.338 -> 0.706 came
// from English tokens in a mixed-language corpus, not from Chinese.)
//
// Switching the tokenizer alone is NOT enough, and is in fact worse: the caller
// passed the whole question into MATCH, and under trigram a long string becomes a
// single contiguous-substring match, which returned 0 hits in testing. So the
// tokenizer and the query builder have to move together — that is why they live in
// the same module.
//
// Rejected alternative: Intl.Segmenter (real word segmentation, zero deps). It
// handles common words but shreds domain terms — 斐波那契 -> 斐/波/那/契,
// 哈希值 -> 哈/希/值. Single-character tokens match nearly everything, so precision
// would land below the status quo. trigram is dumber but has no OOV problem.

export type FtsTokenizer = "trigram" | "unicode61";

/** Trigram cannot match queries shorter than 3 characters — a known limitation. */
const TRIGRAM_SIZE = 3;
/** A long question yields one window per character; cap the OR-expression size. */
export const MAX_FTS_TERMS = 32;

// CJK ideographs + compatibility ideographs. Deliberately excludes punctuation:
// windows should not span a comma.
const CJK_RUN = /[㐀-鿿豈-﫿]+/g;
const LATIN_RUN = /[A-Za-z0-9_]+/g;

/**
 * Resolve the tokenizer, defaulting to trigram. Kept switchable (KNOWHIVE_FTS_TOKENIZER)
 * so the two arms can be compared on the same corpus — the same trick as
 * KNOWHIVE_RERANK_STYLE, which is how the coverage prompt earned its default.
 */
export function ftsTokenizer(raw: string | undefined): FtsTokenizer {
  return raw === "unicode61" ? "unicode61" : "trigram";
}

/** FTS5 string literal: wrap in double quotes, double any internal quote. */
const quote = (term: string) => `"${term.replace(/"/g, '""')}"`;

/**
 * Turn arbitrary user text into a safe FTS5 MATCH expression.
 *
 * Terms are OR-ed rather than AND-ed on purpose: this leg feeds RRF, whose job is
 * to surface candidates the vector leg missed. Requiring every term would make the
 * keyword leg contribute almost nothing on natural-language questions.
 *
 * Quoting every term also closes a real hole — the raw question used to reach
 * MATCH directly, so a quote, `NEAR`, `AND`, `*` or `-` in the user's text was
 * reinterpreted as query syntax, and any resulting syntax error was swallowed,
 * silently dropping the whole keyword leg.
 */
export function buildFtsQuery(text: string, tokenizer: FtsTokenizer): string {
  const terms: string[] = [];
  const seen = new Set<string>();
  const add = (t: string) => {
    if (t.length < 2 || seen.has(t)) return;
    seen.add(t);
    terms.push(t);
  };

  for (const run of text.match(CJK_RUN) ?? []) {
    if (tokenizer === "unicode61") {
      // Whole run: matches how unicode61 indexed it. (It will usually miss — that
      // is the baseline this change exists to fix, preserved for A/B runs.)
      add(run);
      continue;
    }
    const chars = [...run];
    if (chars.length <= TRIGRAM_SIZE) {
      add(run);
      continue;
    }
    for (let i = 0; i + TRIGRAM_SIZE <= chars.length; i++) {
      add(chars.slice(i, i + TRIGRAM_SIZE).join(""));
    }
  }
  for (const word of text.match(LATIN_RUN) ?? []) add(word);

  return terms.slice(0, MAX_FTS_TERMS).map(quote).join(" OR ");
}
