import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { buildFtsQuery, ftsTokenizer, MAX_FTS_TERMS } from "./fts.ts";

// The FTS leg was effectively dead on Chinese: no tokenize= clause meant the
// default unicode61, which treats an unspaced CJK run as ONE token, so a Chinese
// query almost never matched and RRF quietly degraded to vector-only.
//
// Fixing it needs BOTH halves. Switching the tokenizer alone makes things worse:
// under trigram a whole-sentence MATCH becomes one long substring match and
// returns nothing (measured: 0 hits).

describe("buildFtsQuery", () => {
  test("trigram: a CJK run becomes overlapping 3-char windows, OR-joined", () => {
    expect(buildFtsQuery("哈希值", "trigram")).toBe('"哈希值"');
    expect(buildFtsQuery("完整哈希值", "trigram")).toBe('"完整哈" OR "整哈希" OR "哈希值"');
  });

  test("trigram: latin words are kept whole, not shredded", () => {
    // Term order is irrelevant to an OR expression; CJK runs are emitted first.
    expect(buildFtsQuery("Dijkstra 最短路径", "trigram")).toBe(
      '"最短路" OR "短路径" OR "Dijkstra"',
    );
  });

  test("unicode61: CJK runs stay whole so the old behaviour is preserved", () => {
    expect(buildFtsQuery("完整哈希值", "unicode61")).toBe('"完整哈希值"');
  });

  test("strips characters that FTS5 would read as query syntax", () => {
    // Previously the raw question reached MATCH, so a quote, NEAR/AND/OR, * or -
    // was reinterpreted as syntax — and any resulting error was swallowed,
    // silently dropping the entire keyword leg. Extraction now keeps only word
    // characters, so the operators never survive to be interpreted.
    expect(buildFtsQuery('say "hi" NEAR* -foo', "unicode61")).toBe(
      '"say" OR "hi" OR "NEAR" OR "foo"',
    );
    // And a query that is nothing but operators degrades to empty, not to a throw.
    expect(buildFtsQuery('" AND OR *', "unicode61")).toBe('"AND" OR "OR"');
  });

  test("drops single characters that carry no signal", () => {
    expect(buildFtsQuery("a 的 dp", "unicode61")).toBe('"dp"');
  });

  test("returns an empty string for input with no usable terms", () => {
    expect(buildFtsQuery("", "trigram")).toBe("");
    expect(buildFtsQuery("!!! ???", "trigram")).toBe("");
  });

  test("caps the term count so a long question cannot explode into hundreds of trigrams", () => {
    const long = "动态规划的状态转移方程要怎么设计才能避免重复计算子问题".repeat(4);
    const terms = buildFtsQuery(long, "trigram").split(" OR ");
    expect(terms.length).toBeLessThanOrEqual(MAX_FTS_TERMS);
  });

  test("deduplicates repeated windows", () => {
    const q = buildFtsQuery("哈希值 哈希值", "trigram");
    expect(q).toBe('"哈希值"');
  });
});

describe("ftsTokenizer", () => {
  test("defaults to trigram", () => {
    expect(ftsTokenizer(undefined)).toBe("trigram");
  });
  test("honours an explicit unicode61 for A/B runs", () => {
    expect(ftsTokenizer("unicode61")).toBe("unicode61");
  });
  test("ignores an unrecognised value rather than producing invalid DDL", () => {
    expect(ftsTokenizer("porter-stemmer-9000")).toBe("trigram");
  });
});

describe("end-to-end matching against a real FTS5 table", () => {
  function seed(tokenizer: "trigram" | "unicode61") {
    const db = new Database(":memory:");
    const clause = tokenizer === "trigram" ? ", tokenize='trigram'" : "";
    db.exec(`CREATE VIRTUAL TABLE t USING fts5(content${clause})`);
    for (const c of [
      "爬楼梯问题用动态规划解，方法数满足斐波那契递推关系。",
      "堆排序的时间复杂度是 O(n log n)，不稳定。",
      "Dijkstra computes single-source shortest paths.",
    ]) {
      db.query("INSERT INTO t(content) VALUES (?)").run(c);
    }
    return db;
  }
  const hits = (db: Database, q: string) =>
    q ? (db.query("SELECT count(*) c FROM t WHERE t MATCH ?").get(q) as { c: number }).c : 0;

  test("trigram finds Chinese that unicode61 misses", () => {
    const tri = seed("trigram");
    const uni = seed("unicode61");
    for (const q of ["斐波那契", "动态规划", "时间复杂度"]) {
      expect(hits(uni, buildFtsQuery(q, "unicode61"))).toBe(0);
      expect(hits(tri, buildFtsQuery(q, "trigram"))).toBeGreaterThan(0);
    }
  });

  test("a full natural-language question matches under trigram", () => {
    const tri = seed("trigram");
    expect(hits(tri, buildFtsQuery("爬楼梯问题为什么和斐波那契数列有关？", "trigram"))).toBeGreaterThan(0);
  });

  test("english still matches under both", () => {
    for (const tk of ["trigram", "unicode61"] as const) {
      expect(hits(seed(tk), buildFtsQuery("Dijkstra", tk))).toBe(1);
    }
  });
});
