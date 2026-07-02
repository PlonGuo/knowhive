import { test, expect } from "bun:test";
import { rrfFuse } from "./hybrid.ts";

test("rrfFuse: an id ranked high in both lists wins", () => {
  const fused = rrfFuse([
    [1, 2, 3],
    [1, 4, 5],
  ]);
  expect(fused[0]).toBe(1);
});

test("rrfFuse: result is the union of all ids", () => {
  const fused = rrfFuse([
    [1, 2],
    [3, 4],
  ]);
  expect([...fused].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
});

test("rrfFuse: single list preserves its order", () => {
  expect(rrfFuse([[10, 20, 30]])).toEqual([10, 20, 30]);
});

test("rrfFuse: empty input yields empty output", () => {
  expect(rrfFuse([])).toEqual([]);
  expect(rrfFuse([[], []])).toEqual([]);
});
