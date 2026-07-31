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
