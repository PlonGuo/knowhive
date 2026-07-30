import { test, expect } from "bun:test";
import { openDbAt } from "./db.ts";
import { ingestText } from "./ingest.ts";
import { expandToParents, hybridSearch, type ChunkRow } from "./store.ts";

const fakeEmbed = (texts: string[]): Promise<number[][]> =>
  Promise.resolve(texts.map((t) => [t.toLowerCase().includes("dijkstra") ? 1 : 0, 1]));

/** One heading whose body is long enough to be cut into several children. */
const LONG_DOC = [
  "# Dijkstra",
  "",
  "Dijkstra's algorithm finds shortest paths from a source node. " + "detail ".repeat(300),
].join("\n");

test("ingest persists parents, and every child points at one", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "/kb/algo.md", LONG_DOC, fakeEmbed);

  const parents = db.query("SELECT * FROM parent_chunks").all() as { id: number }[];
  const children = db.query("SELECT parent_id FROM chunks").all() as {
    parent_id: number | null;
  }[];

  expect(parents.length).toBeGreaterThan(0);
  expect(children.length).toBeGreaterThan(1);
  const parentIds = new Set(parents.map((p) => p.id));
  expect(children.every((c) => c.parent_id !== null && parentIds.has(c.parent_id))).toBe(true);
});

test("parents are not embedded and not in the FTS index", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "/kb/algo.md", LONG_DOC, fakeEmbed);

  const ftsCount = (db.query("SELECT count(*) AS n FROM chunks_fts").get() as { n: number }).n;
  const childCount = (db.query("SELECT count(*) AS n FROM chunks").get() as { n: number }).n;
  expect(ftsCount).toBe(childCount); // FTS mirrors chunks only — parents are absent.
});

test("expandToParents swaps child text for the wider parent passage", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "/kb/algo.md", LONG_DOC, fakeEmbed);

  const hits = hybridSearch(db, [1, 1], "dijkstra", 3);
  const expanded = expandToParents(db, hits);

  expect(expanded.length).toBeGreaterThan(0);
  const parentTexts = (
    db.query("SELECT content FROM parent_chunks").all() as { content: string }[]
  ).map((p) => p.content);
  expect(parentTexts).toContain(expanded[0]!.content);
});

test("children sharing a parent collapse to one row — no duplicate passages", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "/kb/algo.md", LONG_DOC, fakeEmbed);

  // Several children of the same parent, deliberately over-fetched.
  const hits = hybridSearch(db, [1, 1], "dijkstra", 8);
  const sharedParent = hits.filter((h) => h.parent_id === hits[0]!.parent_id);
  expect(sharedParent.length).toBeGreaterThan(1);

  const expanded = expandToParents(db, hits);
  const parentIds = expanded.map((r) => r.parent_id);
  expect(new Set(parentIds).size).toBe(parentIds.length);
});

test("rows with no parent pass through untouched (pre-migration chunks)", () => {
  const db = openDbAt(":memory:");
  const orphan = {
    id: 1,
    file_path: "/kb/old.md",
    chunk_index: 0,
    content: "legacy text",
    section_heading: null,
    parent_id: null,
    title: null,
    category: null,
    tags: null,
    difficulty: null,
    pack_id: null,
  } satisfies ChunkRow;

  expect(expandToParents(db, [orphan])).toEqual([orphan]);
});

test("re-ingesting a file replaces its parents instead of accumulating them", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "/kb/algo.md", LONG_DOC, fakeEmbed);
  const first = (db.query("SELECT count(*) AS n FROM parent_chunks").get() as { n: number }).n;

  await ingestText(db, "/kb/algo.md", LONG_DOC, fakeEmbed);
  const second = (db.query("SELECT count(*) AS n FROM parent_chunks").get() as { n: number }).n;

  expect(second).toBe(first);
});
