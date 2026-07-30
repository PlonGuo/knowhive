import { test, expect } from "bun:test";
import { chunkDocument, recursiveSplit } from "./chunker.ts";
import { parseMarkdown } from "./markdownIr.ts";

/** Markdown → IR → chunks, the path ingest.ts takes. */
const chunk = (md: string) => chunkDocument(parseMarkdown(md));

test("empty or whitespace text yields no chunks", () => {
  expect(chunk("")).toEqual({ parents: [], children: [] });
  expect(chunk("   \n  ")).toEqual({ parents: [], children: [] });
});

test("no headings: a single chunk with empty section_heading", () => {
  const { children } = chunk("Just some prose about cats and dogs.");
  expect(children.length).toBe(1);
  expect(children[0]!.section_heading).toBe("");
  expect(children[0]!.chunk_index).toBe(0);
});

test("splits by headings, recording section_heading and incrementing index", () => {
  const md = ["# Intro", "x".repeat(150), "## Details", "y".repeat(150)].join("\n\n");
  const { children } = chunk(md);
  expect(children.length).toBe(2);
  expect(children[0]!.section_heading).toBe("Intro");
  expect(children[1]!.section_heading).toBe("Details");
  expect(children.map((c) => c.chunk_index)).toEqual([0, 1]);
});

test("a short section (<100 chars) is merged into the next", () => {
  const md = ["# Tiny", "short", "# Big", "z".repeat(150)].join("\n\n");
  const { children } = chunk(md);
  expect(children.length).toBe(1);
  expect(children[0]!.content).toContain("short");
  expect(children[0]!.content).toContain("z".repeat(150));
});

test("a long section (>1500 chars) is sub-split into multiple indexed chunks", () => {
  const long = "word ".repeat(500).trim(); // ~2500 chars
  const { children } = chunk("# Long\n\n" + long);
  expect(children.length).toBeGreaterThan(1);
  expect(children.every((c) => c.section_heading === "Long")).toBe(true);
  expect(children.map((c) => c.chunk_index)).toEqual(children.map((_, i) => i));
  expect(children.every((c) => c.content.length <= 1100)).toBe(true);
});

// --- parent/child -----------------------------------------------------------

test("every child points at a real parent", () => {
  const { parents, children } = chunk("# Long\n\n" + "word ".repeat(500).trim());
  expect(parents.length).toBeGreaterThan(0);
  for (const c of children) {
    expect(parents[c.parent_index]).toBeDefined();
    expect(parents[c.parent_index]!.parent_index).toBe(c.parent_index);
  }
});

test("a child's text is contained in its parent — expansion never changes the subject", () => {
  const { parents, children } = chunk("# Long\n\n" + "word ".repeat(500).trim());
  for (const c of children) {
    expect(parents[c.parent_index]!.content).toContain(c.content);
  }
});

test("the parent is the wider passage: bigger than the child that matched", () => {
  const { parents, children } = chunk("# Long\n\n" + "word ".repeat(500).trim());
  const widened = children.filter(
    (c) => parents[c.parent_index]!.content.length > c.content.length,
  );
  expect(widened.length).toBeGreaterThan(0);
});

test("a section that fits in one chunk has parent === child", () => {
  const md = "# Small\n\n" + "x".repeat(150);
  const { parents, children } = chunk(md);
  expect(parents.length).toBe(1);
  expect(children.length).toBe(1);
  expect(parents[0]!.content).toBe(children[0]!.content);
});

test("parents are capped so expansion can't paste a whole chapter into the prompt", () => {
  const huge = "word ".repeat(4000).trim(); // ~20k chars
  const { parents } = chunk("# Huge\n\n" + huge);
  expect(parents.length).toBeGreaterThan(1);
  expect(parents.every((p) => p.content.length <= 4400)).toBe(true);
});

test("children never straddle a parent boundary", () => {
  const { parents, children } = chunk("# Huge\n\n" + "word ".repeat(4000).trim());
  // If a child spanned two parents, it could not be a substring of either.
  for (const c of children) {
    expect(parents[c.parent_index]!.content.includes(c.content)).toBe(true);
  }
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
