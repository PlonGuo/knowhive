import { expect, test } from "bun:test";
import { DEFAULT_RELEVANCE_FLOOR, relevanceFloor, rerankCrossEncoder } from "./crossEncoder.ts";

const chunks = [{ content: "a" }, { content: "b" }, { content: "c" }];

test("abstains when the best candidate scores below the floor", async () => {
  const score = async () => [-6.1, -3.2, -4.0]; // best is -3.2, below floor
  expect(await rerankCrossEncoder("q", chunks, 2, score, -2)).toEqual([]);
});

test("keeps results when the best candidate clears the floor", async () => {
  const score = async () => [-6.1, 1.4, -4.0]; // best is 1.4
  const out = await rerankCrossEncoder("q", chunks, 2, score, -2);
  expect(out.map((c) => c.content)).toEqual(["b", "c"]);
});

test("gates on the best score only — weak tail candidates still ride along", async () => {
  // The floor answers "did retrieval find anything at all", not "is every chunk good".
  const score = async () => [5.0, -9.9, -9.9];
  const out = await rerankCrossEncoder("q", chunks, 3, score, -2);
  expect(out).toHaveLength(3);
});

test("no floor supplied — never abstains (opt-in gate)", async () => {
  const score = async () => [-9, -9, -9];
  expect(await rerankCrossEncoder("q", chunks, 2, score)).toHaveLength(2);
});

test("scorer failure does not trigger abstention — fails open, not closed", async () => {
  // A dead reranker must degrade to hybrid order, never to a wrongful "I don't know".
  const score = async () => {
    throw new Error("model down");
  };
  const out = await rerankCrossEncoder("q", chunks, 2, score, -2);
  expect(out.map((c) => c.content)).toEqual(["a", "b"]);
});

test("relevanceFloor reads the env override, else the calibrated default", () => {
  expect(relevanceFloor(undefined)).toBe(DEFAULT_RELEVANCE_FLOOR);
  expect(relevanceFloor("-3.5")).toBe(-3.5);
  expect(relevanceFloor("0")).toBe(0);
  expect(relevanceFloor("off")).toBeNull();
  expect(relevanceFloor("garbage")).toBe(DEFAULT_RELEVANCE_FLOOR);
});

test("sorts by score descending and takes top-k", async () => {
  const score = async () => [0.1, 0.9, 0.5]; // b > c > a
  const out = await rerankCrossEncoder("q", chunks, 2, score);
  expect(out.map((c) => c.content)).toEqual(["b", "c"]);
});

test("fails open to input order when scorer throws", async () => {
  const score = async () => {
    throw new Error("model down");
  };
  const out = await rerankCrossEncoder("q", chunks, 2, score);
  expect(out.map((c) => c.content)).toEqual(["a", "b"]);
});

test("fails open when the scorer returns a mismatched length", async () => {
  const score = async () => [0.9]; // 1 score for 3 chunks
  const out = await rerankCrossEncoder("q", chunks, 2, score);
  expect(out.map((c) => c.content)).toEqual(["a", "b"]);
});

test("handles <=1 chunk without scoring", async () => {
  const score = async () => {
    throw new Error("should not be called");
  };
  const out = await rerankCrossEncoder("q", [{ content: "x" }], 5, score);
  expect(out.map((c) => c.content)).toEqual(["x"]);
  expect(await rerankCrossEncoder("q", [], 5, score)).toEqual([]);
});

// --- gate observer (feeds the abstention-gate span; must never alter behaviour) ---

test("observer reports the top score and an abstain decision", async () => {
  const seen: unknown[] = [];
  const score = async () => [-6.1, -3.2, -4.0];
  const out = await rerankCrossEncoder("q", chunks, 2, score, -2, (info) => seen.push(info));
  expect(out).toEqual([]);
  expect(seen).toEqual([{ topScore: -3.2, floor: -2, abstained: true }]);
});

test("observer reports an answer decision when the floor is cleared", async () => {
  const seen: unknown[] = [];
  const score = async () => [-6.1, 1.4, -4.0];
  await rerankCrossEncoder("q", chunks, 2, score, -2, (info) => seen.push(info));
  expect(seen).toEqual([{ topScore: 1.4, floor: -2, abstained: false }]);
});

test("observer still fires with the gate disabled, so 'no floor' stays distinguishable", async () => {
  const seen: { topScore: number; floor: number | null; abstained: boolean }[] = [];
  const score = async () => [-9, -9, -9];
  const out = await rerankCrossEncoder("q", chunks, 2, score, null, (info) => seen.push(info));
  expect(out.length).toBe(2);
  expect(seen).toEqual([{ topScore: -9, floor: null, abstained: false }]);
});

test("observer is NOT called when the reranker fails open — a crash is not evidence", async () => {
  const seen: unknown[] = [];
  const score = async () => {
    throw new Error("model down");
  };
  const out = await rerankCrossEncoder("q", chunks, 2, score, -2, (info) => seen.push(info));
  expect(out.length).toBe(2); // fell back to hybrid order
  expect(seen).toEqual([]); // span will read "not-scored", never "answer"
});

test("a throwing observer cannot change the result", async () => {
  const score = async () => [-6.1, 1.4, -4.0];
  const out = await rerankCrossEncoder("q", chunks, 2, score, -2, () => {
    throw new Error("observer blew up");
  });
  expect(out.map((c) => c.content)).toEqual(["b", "c"]);
});
