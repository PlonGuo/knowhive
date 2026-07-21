import { expect, test } from "bun:test";
import { rerankCrossEncoder } from "./crossEncoder.ts";

const chunks = [{ content: "a" }, { content: "b" }, { content: "c" }];

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
