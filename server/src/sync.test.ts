import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDbAt } from "./db.ts";
import { ingestText } from "./ingest.ts";
import { syncKnowledgeDir } from "./sync.ts";

// Parity tests against backend/app/services/sync_service.py:
// new → embed, modified (hash differs) → re-embed, deleted → remove, unchanged → skip.

const fakeEmbed = (texts: string[]): Promise<number[][]> =>
  Promise.resolve(texts.map(() => [1, 0, 0]));

const DOC =
  "# Note\nSome knowledge base content that is long enough to survive chunking and be stored as one chunk.\n";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowhive-sync-"));
  const db = openDbAt(":memory:");
  const ingestedPaths: string[] = [];
  const ingestFile = async (absPath: string) => {
    ingestedPaths.push(absPath);
    await ingestText(db, absPath, await Bun.file(absPath).text(), fakeEmbed);
  };
  return { dir, db, ingestedPaths, ingestFile };
}

test("sync ingests files on disk that are missing from the db", async () => {
  const { dir, db, ingestFile } = setup();
  writeFileSync(join(dir, "new.md"), DOC);
  const stats = await syncKnowledgeDir(db, dir, ingestFile);
  expect(stats).toEqual({ new: 1, modified: 0, deleted: 0, errors: [] });
  const row = db.query("SELECT COUNT(*) AS c FROM documents").get() as { c: number };
  expect(row.c).toBe(1);
});

test("sync skips unchanged files (hash match)", async () => {
  const { dir, db, ingestedPaths, ingestFile } = setup();
  writeFileSync(join(dir, "same.md"), DOC);
  await syncKnowledgeDir(db, dir, ingestFile);
  ingestedPaths.length = 0;

  const stats = await syncKnowledgeDir(db, dir, ingestFile);
  expect(stats).toEqual({ new: 0, modified: 0, deleted: 0, errors: [] });
  expect(ingestedPaths).toEqual([]);
});

test("sync re-ingests files whose content changed", async () => {
  const { dir, db, ingestFile } = setup();
  const path = join(dir, "edit.md");
  writeFileSync(path, DOC);
  await syncKnowledgeDir(db, dir, ingestFile);

  writeFileSync(path, DOC + "\nAppended line that changes the hash of this file.\n");
  const stats = await syncKnowledgeDir(db, dir, ingestFile);
  expect(stats).toEqual({ new: 0, modified: 1, deleted: 0, errors: [] });
});

test("sync removes db rows for files deleted from disk", async () => {
  const { dir, db, ingestFile } = setup();
  const path = join(dir, "gone.md");
  writeFileSync(path, DOC);
  await syncKnowledgeDir(db, dir, ingestFile);

  rmSync(path);
  const stats = await syncKnowledgeDir(db, dir, ingestFile);
  expect(stats).toEqual({ new: 0, modified: 0, deleted: 1, errors: [] });
  expect((db.query("SELECT COUNT(*) AS c FROM documents").get() as { c: number }).c).toBe(0);
  expect((db.query("SELECT COUNT(*) AS c FROM chunks").get() as { c: number }).c).toBe(0);
});

test("sync collects per-file errors and keeps going", async () => {
  const { dir, db } = setup();
  writeFileSync(join(dir, "bad.md"), DOC);
  writeFileSync(join(dir, "good.md"), DOC);
  const ingestFile = async (absPath: string) => {
    if (absPath.includes("bad")) throw new Error("boom");
    await ingestText(db, absPath, await Bun.file(absPath).text(), fakeEmbed);
  };
  const stats = await syncKnowledgeDir(db, dir, ingestFile);
  expect(stats.new).toBe(1);
  expect(stats.errors.length).toBe(1);
  expect(stats.errors[0]).toContain("bad.md");
});
