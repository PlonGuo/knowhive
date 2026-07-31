import { test, expect } from "bun:test";
import { openDbAt } from "./db.ts";
import { ingestDirectory, ingestText } from "./ingest.ts";
import { hybridSearch } from "./store.ts";

// Deterministic fake embedder: a 3-dim topic vector [cat, dog, transformer].
// Lets us assert retrieval behavior without depending on Ollama.
const fakeEmbed = (texts: string[]): Promise<number[][]> =>
  Promise.resolve(
    texts.map((t) => {
      const s = t.toLowerCase();
      return [
        s.includes("cat") ? 1 : 0,
        s.includes("dog") ? 1 : 0,
        s.includes("transformer") || s.includes("attention") ? 1 : 0,
      ];
    }),
  );

// Each section is >100 chars so the short-section merge doesn't collapse them, and the
// document totals >1000 chars so routing keeps sections separate instead of whole-doc.
const section = (s: string) => Array(3).fill(s).join(" ");
const DOC = [
  "# Cats",
  section("Cats are small domesticated carnivorous mammals that are often kept as pets by humans in households all around the world today."),
  "# Dogs",
  section("Dogs are loyal domesticated animals that are commonly kept as companions and working partners by people across many cultures."),
  "# Transformers",
  section("Transformers use self attention mechanisms to process token sequences in modern deep learning architectures for language tasks."),
].join("\n");

test("ingestText stores one chunk per section and reports the count", async () => {
  const db = openDbAt(":memory:");
  const res = await ingestText(db, "animals.md", DOC, fakeEmbed);
  expect(res.chunkCount).toBe(3);
  const row = db.query("SELECT COUNT(*) AS c FROM chunks").get() as { c: number };
  expect(row.c).toBe(3);
  db.close();
});

test("hybrid search retrieves the semantically matching chunk", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  const [qvec] = await fakeEmbed(["tell me about cats"]);
  const hits = hybridSearch(db, qvec!, "cats", 2);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]!.content.toLowerCase()).toContain("cat");
  db.close();
});

test("re-ingest of the same file is idempotent (no duplicate chunks)", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  const row = db.query("SELECT COUNT(*) AS c FROM chunks").get() as { c: number };
  expect(row.c).toBe(3);
  db.close();
});

test("ingestDirectory recursively ingests .md files and skips other extensions", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "knowhive-ingestdir-"));
  writeFileSync(join(dir, "a.md"), DOC);
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "nested", "b.md"), DOC);
  writeFileSync(join(dir, "ignore.txt"), "not markdown");

  const db = openDbAt(":memory:");
  const results = await ingestDirectory(db, dir, fakeEmbed);
  expect(results.map((r) => r.filePath).sort()).toEqual([join(dir, "a.md"), join(dir, "nested", "b.md")]);
  const row = db.query("SELECT COUNT(*) AS c FROM documents").get() as { c: number };
  expect(row.c).toBe(2);
  db.close();
});

test("ingestDirectory on a missing directory returns empty results", async () => {
  const db = openDbAt(":memory:");
  const results = await ingestDirectory(db, "/nonexistent/knowledge", fakeEmbed);
  expect(results).toEqual([]);
  db.close();
});

test("ingestText records the chunk strategy on the documents row", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  const row = db
    .query("SELECT chunk_strategy FROM documents WHERE file_path = 'animals.md'")
    .get() as { chunk_strategy: string };
  expect(row.chunk_strategy).toBe("section-as-chunk");

  await ingestText(db, "empty.md", "", fakeEmbed);
  const empty = db
    .query("SELECT chunk_strategy, status FROM documents WHERE file_path = 'empty.md'")
    .get() as { chunk_strategy: string; status: string };
  expect(empty.chunk_strategy).toBe("empty");
  expect(empty.status).toBe("empty");
  db.close();
});

test("ingestText stores the content sha256 and byte size on the documents row", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  const row = db
    .query("SELECT file_hash, file_size FROM documents WHERE file_path = 'animals.md'")
    .get() as { file_hash: string; file_size: number };
  const expected = new Bun.CryptoHasher("sha256").update(DOC).digest("hex");
  expect(row.file_hash).toBe(expected);
  expect(row.file_size).toBe(Buffer.byteLength(DOC));
});
