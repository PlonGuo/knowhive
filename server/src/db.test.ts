import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDbAt } from "./db.ts";

test("openDbAt adds chunk_strategy to a documents table created before the column existed", () => {
  // Ensure the custom SQLite is initialised before opening a raw Database below.
  openDbAt(":memory:").close();

  // Simulate a pre-chunk_strategy database: CREATE IF NOT EXISTS won't touch it, so the
  // column has to arrive via migrate().
  const path = join(mkdtempSync(join(tmpdir(), "knowhive-db-")), "old.db");
  const raw = new Database(path, { create: true });
  raw.exec(`CREATE TABLE documents (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path   TEXT NOT NULL UNIQUE,
    file_name   TEXT NOT NULL,
    modified_at TEXT NOT NULL
  )`);
  raw.close();

  const db = openDbAt(path);
  const cols = db.query("PRAGMA table_info(documents)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "chunk_strategy")).toBe(true);
  db.close();
});

test("chunks(file_path) is indexed — every delete/rename/re-ingest keys on it", () => {
  const db = openDbAt(":memory:");
  const idx = db
    .query("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='chunks'")
    .all() as { name: string }[];
  expect(idx.map((r) => r.name)).toContain("chunks_file");
});

test("chunks_fts is created with the trigram tokenizer by default", () => {
  const db = openDbAt(":memory:");
  const sql = (
    db.query("SELECT sql FROM sqlite_master WHERE name='chunks_fts'").get() as { sql: string }
  ).sql;
  expect(sql).toContain("trigram");
});

test("an existing unicode61 index is rebuilt, not silently left behind", () => {
  // Without this, an upgrading user keeps the old index forever: the schema uses
  // CREATE VIRTUAL TABLE IF NOT EXISTS, which is a no-op once the table exists.
  const dir = mkdtempSync(join(tmpdir(), "knowhive-fts-"));
  const path = join(dir, "k.db");

  const old = openDbAt(path, "unicode61");
  old.run(
    // Spaces make the unicode61 token boundaries explicit: it indexes '完整哈希值'
    // as ONE token, so the substring '哈希值' cannot match. That is the bug.
    "INSERT INTO chunks (file_path, chunk_index, content) VALUES ('a.md', 0, '完整哈希值 是 SHA-1 校验和')",
  );
  const matches = (db: Database, q: string) =>
    (db.query("SELECT count(*) c FROM chunks_fts WHERE chunks_fts MATCH ?").get(q) as { c: number })
      .c;
  expect(matches(old, '"完整哈希值"')).toBe(1);
  expect(matches(old, '"哈希值"')).toBe(0); // the whole point: Chinese substrings miss
  old.close();

  const migrated = openDbAt(path, "trigram");
  expect(
    (migrated.query("SELECT sql FROM sqlite_master WHERE name='chunks_fts'").get() as { sql: string })
      .sql,
  ).toContain("trigram");
  // Rebuilt from the chunks table, so pre-existing rows are searchable immediately
  // — no re-ingest required.
  expect(matches(migrated, '"哈希值"')).toBe(1);
  expect(
    (migrated.query("SELECT count(*) c FROM chunks").get() as { c: number }).c,
  ).toBe(1);
});

test("reopening with the same tokenizer does not rebuild", () => {
  const dir = mkdtempSync(join(tmpdir(), "knowhive-fts2-"));
  const path = join(dir, "k.db");
  const a = openDbAt(path, "trigram");
  a.run("INSERT INTO chunks (file_path, chunk_index, content) VALUES ('a.md', 0, '动态规划')");
  a.close();
  const b = openDbAt(path, "trigram");
  expect(
    (b.query("SELECT count(*) c FROM chunks_fts WHERE chunks_fts MATCH ?").get('"动态规划"') as {
      c: number;
    }).c,
  ).toBe(1);
});
