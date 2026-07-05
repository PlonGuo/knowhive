import { test, expect } from "bun:test";
import { buildRerankPrompt, parseRanking, rerankChunks } from "./rerank.ts";

// Phase E: LLM-as-reranker. A single listwise call ranks hybrid-search candidates;
// parsing is defensive and the whole step fails open to the original order.

const chunk = (content: string) => ({ content, file_path: `${content}.md` });

test("buildRerankPrompt numbers candidates and includes the query", () => {
  const prompt = buildRerankPrompt("what is RRF?", ["chunk one", "chunk two"]);
  expect(prompt).toContain("what is RRF?");
  expect(prompt).toContain("[1] chunk one");
  expect(prompt).toContain("[2] chunk two");
});

test("buildRerankPrompt truncates very long chunk contents", () => {
  const prompt = buildRerankPrompt("q", ["x".repeat(2000)]);
  expect(prompt.length).toBeLessThan(1500);
});

test("parseRanking reads a clean JSON array", () => {
  expect(parseRanking("[2, 1, 3]", 3)).toEqual([2, 1, 3]);
});

test("parseRanking extracts the array from surrounding prose", () => {
  expect(parseRanking("Sure! The ranking is:\n[3, 1, 2]\nHope that helps.", 3)).toEqual([3, 1, 2]);
});

test("parseRanking drops out-of-range and duplicate indices, appends missing ones", () => {
  // 5 and 0 invalid, 2 repeated; missing 3 appended in original order
  expect(parseRanking("[2, 5, 2, 0, 1]", 3)).toEqual([2, 1, 3]);
});

test("parseRanking returns null when no array is present", () => {
  expect(parseRanking("I cannot rank these.", 3)).toBeNull();
});

test("rerankChunks reorders by the LLM ranking and keeps top k", async () => {
  const chunks = [chunk("a"), chunk("b"), chunk("c"), chunk("d")];
  const result = await rerankChunks("q", chunks, 2, async () => "[3, 1, 4, 2]");
  expect(result.map((c) => c.content)).toEqual(["c", "a"]);
});

test("rerankChunks pads a partial ranking with the remaining candidates", async () => {
  const chunks = [chunk("a"), chunk("b"), chunk("c")];
  const result = await rerankChunks("q", chunks, 3, async () => "[2]");
  expect(result.map((c) => c.content)).toEqual(["b", "a", "c"]);
});

test("rerankChunks fails open to the original order on unparseable output", async () => {
  const chunks = [chunk("a"), chunk("b"), chunk("c")];
  const result = await rerankChunks("q", chunks, 2, async () => "no array here");
  expect(result.map((c) => c.content)).toEqual(["a", "b"]);
});

test("rerankChunks fails open when the LLM call throws", async () => {
  const chunks = [chunk("a"), chunk("b")];
  const result = await rerankChunks("q", chunks, 2, async () => {
    throw new Error("ollama down");
  });
  expect(result.map((c) => c.content)).toEqual(["a", "b"]);
});

test("rerankChunks skips the LLM entirely for 0 or 1 candidates", async () => {
  let called = 0;
  const generate = async () => {
    called++;
    return "[1]";
  };
  expect(await rerankChunks("q", [], 5, generate)).toEqual([]);
  expect((await rerankChunks("q", [chunk("only")], 5, generate)).length).toBe(1);
  expect(called).toBe(0);
});

test("coverage style adds a diversity instruction to the prompt", () => {
  const relevance = buildRerankPrompt("q", ["a", "b"]);
  const coverage = buildRerankPrompt("q", ["a", "b"], "coverage");
  expect(relevance).not.toContain("different aspects");
  expect(coverage).toContain("different aspects");
  // Ranking contract stays identical so parseRanking is unaffected.
  expect(coverage).toContain("ONLY a JSON array");
});
