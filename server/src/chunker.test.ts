import { test, expect } from "bun:test";
import { splitByHeadings, recursiveSplit } from "./chunker.ts";

test("empty or whitespace text yields no chunks", () => {
  expect(splitByHeadings("")).toEqual([]);
  expect(splitByHeadings("   \n  ")).toEqual([]);
});

test("no headings: a single chunk with empty section_heading", () => {
  const chunks = splitByHeadings("Just some prose about cats and dogs.");
  expect(chunks.length).toBe(1);
  expect(chunks[0]!.section_heading).toBe("");
  expect(chunks[0]!.chunk_index).toBe(0);
});

test("splits by headings, recording section_heading and incrementing index", () => {
  const md = ["# Intro", "x".repeat(150), "## Details", "y".repeat(150)].join("\n");
  const chunks = splitByHeadings(md);
  expect(chunks.length).toBe(2);
  expect(chunks[0]!.section_heading).toBe("Intro");
  expect(chunks[1]!.section_heading).toBe("Details");
  expect(chunks.map((c) => c.chunk_index)).toEqual([0, 1]);
});

test("a short section (<100 chars) is merged into the next", () => {
  const md = ["# Tiny", "short", "# Big", "z".repeat(150)].join("\n");
  const chunks = splitByHeadings(md);
  expect(chunks.length).toBe(1);
  expect(chunks[0]!.content).toContain("short");
  expect(chunks[0]!.content).toContain("z".repeat(150));
});

test("a long section (>1500 chars) is sub-split into multiple indexed chunks", () => {
  const long = "word ".repeat(500).trim(); // ~2500 chars
  const chunks = splitByHeadings("# Long\n" + long);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => c.section_heading === "Long")).toBe(true);
  expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
  expect(chunks.every((c) => c.content.length <= 1100)).toBe(true);
});

test("recursiveSplit yields multiple pieces bounded by chunkSize", () => {
  const text = Array.from(
    { length: 20 },
    (_, i) => `Paragraph number ${i} with some filler text.`,
  ).join("\n\n");
  const pieces = recursiveSplit(text, 120, 30);
  expect(pieces.length).toBeGreaterThan(1);
  expect(pieces.every((p) => p.length <= 180)).toBe(true);
});
