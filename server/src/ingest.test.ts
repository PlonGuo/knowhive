import { test, expect } from "bun:test";
import { openDbAt } from "./db.ts";
import { findIngestableFiles, ingestDirectory, ingestIR, ingestLocalFile, ingestText, markDocumentError } from "./ingest.ts";
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

test("ingestDirectory recursively ingests local formats (md/txt) and skips unknown extensions", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "knowhive-ingestdir-"));
  writeFileSync(join(dir, "a.md"), DOC);
  mkdirSync(join(dir, "nested"), { recursive: true });
  writeFileSync(join(dir, "nested", "b.md"), DOC);
  writeFileSync(join(dir, "notes.txt"), "plain text about cats and their habits");
  writeFileSync(join(dir, "ignore.png"), "not text");

  const db = openDbAt(":memory:");
  const results = await ingestDirectory(db, dir, fakeEmbed);
  expect(results.map((r) => r.filePath).sort()).toEqual([
    join(dir, "a.md"),
    join(dir, "nested", "b.md"),
    join(dir, "notes.txt"),
  ]);
  const row = db.query("SELECT COUNT(*) AS c FROM documents").get() as { c: number };
  expect(row.c).toBe(3);
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

test("ingestIR ingests a plugin-produced DocumentIR (PDF path)", async () => {
  const db = openDbAt(":memory:");
  const ir = {
    format: "pdf" as const,
    blocks: [
      { type: "heading" as const, text: "深入理解检索", level: 1, order: 0, page: 1 },
      ...Array.from({ length: 6 }, (_, i) => ({
        type: "paragraph" as const,
        text: `第${i}段：向量检索与关键词检索的融合策略讨论。`.repeat(6),
        order: i + 1,
        page: 1,
      })),
    ],
  };
  const res = await ingestIR(db, "docs/retrieval.pdf", ir, "rawbytes-hash", 12345, fakeEmbed);
  expect(res.chunkCount).toBeGreaterThan(0);
  const doc = db
    .query("SELECT chunk_count, chunk_strategy, file_hash, file_size, status FROM documents WHERE file_path = 'docs/retrieval.pdf'")
    .get() as { chunk_count: number; chunk_strategy: string; file_hash: string; file_size: number; status: string };
  expect(doc.status).toBe("indexed");
  expect(doc.chunk_count).toBe(res.chunkCount);
  expect(doc.chunk_strategy).toBeTruthy();
  expect(doc.file_hash).toBe("rawbytes-hash");
  expect(doc.file_size).toBe(12345);
  // Re-ingest is idempotent like the text path.
  await ingestIR(db, "docs/retrieval.pdf", ir, "rawbytes-hash", 12345, fakeEmbed);
  const n = db.query("SELECT COUNT(*) AS c FROM chunks WHERE file_path = 'docs/retrieval.pdf'").get() as { c: number };
  expect(n.c).toBe(res.chunkCount);
  db.close();
});

test("findIngestableFiles lists local formats always and pdf only when asked", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "knowhive-findpdf-"));
  writeFileSync(join(dir, "a.md"), "# a");
  writeFileSync(join(dir, "b.pdf"), "%PDF-fake");
  writeFileSync(join(dir, "c.txt"), "plain text");
  writeFileSync(join(dir, "d.docx"), "fake");
  writeFileSync(join(dir, "e.png"), "nope");

  const local = await findIngestableFiles(dir, { includePdf: false });
  expect(local.map((p) => p.split("/").pop())).toEqual(["a.md", "c.txt", "d.docx"]);
  const withPdf = await findIngestableFiles(dir, { includePdf: true });
  expect(withPdf.map((p) => p.split("/").pop())).toEqual(["a.md", "b.pdf", "c.txt", "d.docx"]);
});

test("ingestLocalFile dispatches txt and docx to their producers", async () => {
  const { mkdtempSync, writeFileSync, copyFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "knowhive-local-"));
  writeFileSync(
    join(dir, "novel.txt"),
    "The cat sat quietly.\n\n" + "Dogs are loyal companions to people everywhere. ".repeat(30),
  );
  copyFileSync(join(import.meta.dir, "..", "test-fixtures", "sample.docx"), join(dir, "doc.docx"));

  const db = openDbAt(":memory:");
  const txtRes = await ingestLocalFile(db, join(dir, "novel.txt"), fakeEmbed);
  expect(txtRes.chunkCount).toBeGreaterThan(0);
  const docxRes = await ingestLocalFile(db, join(dir, "doc.docx"), fakeEmbed);
  expect(docxRes.chunkCount).toBeGreaterThan(0);

  const rows = db
    .query("SELECT file_name, status, chunk_strategy FROM documents ORDER BY file_name")
    .all() as { file_name: string; status: string; chunk_strategy: string }[];
  expect(rows).toHaveLength(2);
  expect(rows.every((r) => r.status === "indexed")).toBe(true);
  // txt has no headings → sliding-window (or whole-doc if tiny); docx has real structure.
  const txtRow = rows.find((r) => r.file_name === "novel.txt")!;
  expect(["sliding-window", "whole-doc"]).toContain(txtRow.chunk_strategy);
  db.close();
});

test("markDocumentError records a failed file on the documents table", () => {
  const db = openDbAt(":memory:");
  markDocumentError(db, "notes/scan.pdf", "needs_ocr: scanned document");
  const row = db
    .query("SELECT status, error_message, chunk_count FROM documents WHERE file_path = 'notes/scan.pdf'")
    .get() as { status: string; error_message: string; chunk_count: number };
  expect(row.status).toBe("error");
  expect(row.error_message).toContain("needs_ocr");
  expect(row.chunk_count).toBe(0);
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
