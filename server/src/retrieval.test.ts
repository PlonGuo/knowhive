import { test, expect } from "bun:test";
import {
  cosineSimilarity,
  knn,
  encodeVector,
  decodeVector,
  BruteForceIndex,
} from "./retrieval.ts";

test("cosineSimilarity: identical vectors = 1", () => {
  expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
});

test("cosineSimilarity: orthogonal = 0", () => {
  expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
});

test("cosineSimilarity: opposite = -1", () => {
  expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
});

test("cosineSimilarity: 45 degrees ~= 0.7071", () => {
  expect(cosineSimilarity([1, 1], [1, 0])).toBeCloseTo(Math.SQRT1_2);
});

test("cosineSimilarity: magnitude-invariant", () => {
  expect(cosineSimilarity([2, 0], [5, 0])).toBeCloseTo(1);
});

test("cosineSimilarity: dimension mismatch throws", () => {
  expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
});

test("knn: returns top-k ordered by similarity desc", () => {
  const candidates = [
    { id: 1, vector: [1, 0] },
    { id: 2, vector: [0, 1] },
    { id: 3, vector: [0.9, 0.1] },
  ];
  const res = knn([1, 0], candidates, 2);
  expect(res.map((r) => r.id)).toEqual([1, 3]);
  expect(res[0]!.score).toBeGreaterThan(res[1]!.score);
});

test("knn: k larger than candidates returns all", () => {
  const res = knn([1, 0], [{ id: 1, vector: [1, 0] }], 5);
  expect(res.length).toBe(1);
});

test("BruteForceIndex.search returns top-k over a lazy candidate set", () => {
  const idx = new BruteForceIndex(() => [
    { id: 1, vector: [1, 0] },
    { id: 2, vector: [0, 1] },
    { id: 3, vector: [0.8, 0.2] },
  ]);
  const res = idx.search([1, 0], 2);
  expect(res.map((r) => r.id)).toEqual([1, 3]);
});

test("BruteForceIndex re-reads candidates each search (rebuildable/derived)", () => {
  const store: { id: number; vector: number[] }[] = [{ id: 1, vector: [1, 0] }];
  const idx = new BruteForceIndex(() => store);
  expect(idx.search([1, 0], 5).length).toBe(1);
  store.push({ id: 2, vector: [0.9, 0.1] });
  expect(idx.search([1, 0], 5).length).toBe(2);
});

test("encode/decode round-trips a float32 vector", () => {
  const v = [0.1, -0.2, 0.333, 1.5];
  const back = decodeVector(encodeVector(v));
  expect(back.length).toBe(4);
  for (let i = 0; i < v.length; i++) expect(back[i]!).toBeCloseTo(v[i]!, 5);
});
