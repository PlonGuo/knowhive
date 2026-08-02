// SQLite storage for the sidecar (bun:sqlite + sqlite-vec extension).
// Relational tables are ported 1:1 from backend/app/database.py. Hybrid search adds a
// `chunks` table + FTS5 mirror here; the vec0 virtual table (dimension-dependent on the
// embedding model) is created in Phase B once the embedding dimension is known.
import { Database } from "bun:sqlite";
import { ftsTokenizer, type FtsTokenizer } from "./fts.ts";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as sqliteVec from "sqlite-vec";

// macOS ships a system SQLite with dynamic extension loading DISABLED, so loading
// sqlite-vec needs a SQLite build that allows extensions. In dev we point bun at
// Homebrew's libsqlite3. (Distribution will bundle one — or fall back to brute-force
// KNN in TS — decided at Phase B.) Must run before any Database is opened.
let sqliteInitialized = false;
export function initSqlite(): void {
  if (sqliteInitialized) return;
  sqliteInitialized = true;
  if (process.platform === "darwin") {
    const candidates = [
      "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
      "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
    ];
    const found = candidates.find((p) => existsSync(p));
    if (found) Database.setCustomSQLite(found);
  }
}

// Ported from backend/app/database.py:SQL_CREATE_TABLES (+ chunk_strategy migration col).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL UNIQUE,
  file_name       TEXT NOT NULL,
  file_size       INTEGER,
  file_hash       TEXT,
  modified_at     TEXT NOT NULL,
  indexed_at      TEXT,
  chunk_count     INTEGER DEFAULT 0,
  status          TEXT DEFAULT 'pending',
  error_message   TEXT,
  title           TEXT,
  category        TEXT,
  tags            TEXT,
  difficulty      TEXT,
  pack_id         TEXT,
  chunk_strategy  TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  sources         TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingest_tasks (
  id              TEXT PRIMARY KEY,
  status          TEXT DEFAULT 'pending',
  total_files     INTEGER DEFAULT 0,
  processed_files INTEGER DEFAULT 0,
  errors          TEXT,
  created_at      TEXT DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS chat_summaries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  summary           TEXT NOT NULL,
  first_message_id  INTEGER NOT NULL,
  last_message_id   INTEGER NOT NULL,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL UNIQUE,
  summary         TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Phase M: multi-session chat + layered memory.
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  title           TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- kind: 'episodic' (per-turn trace, no embedding) | 'semantic' (distilled fact, embedded).
CREATE TABLE IF NOT EXISTS memories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  session_id      TEXT,
  content         TEXT NOT NULL,
  embedding       BLOB,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS review_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL,
  question        TEXT NOT NULL,
  answer          TEXT NOT NULL,
  repetitions     INTEGER DEFAULT 0,
  easiness        REAL DEFAULT 2.5,
  interval        INTEGER DEFAULT 1,
  due_date        TEXT NOT NULL,
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- Parent chunks: the larger passage a child was split out of. Never embedded and never
-- in FTS — they exist only to be swapped in for a matched child at answer time.
CREATE TABLE IF NOT EXISTS parent_chunks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL,
  parent_index    INTEGER NOT NULL,
  content         TEXT NOT NULL,
  section_heading TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS parent_chunks_file ON parent_chunks(file_path);

-- Chunk store + FTS5 mirror for hybrid retrieval (replaces ChromaDB's doc store).
CREATE TABLE IF NOT EXISTS chunks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path       TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  content         TEXT NOT NULL,
  section_heading TEXT,
  parent_id       INTEGER,
  embedding       BLOB,
  title           TEXT,
  category        TEXT,
  tags            TEXT,
  difficulty      TEXT,
  pack_id         TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

-- deleteChunksForFile / renameChunksFilePath / storeChunks all key on file_path.
CREATE INDEX IF NOT EXISTS chunks_file ON chunks(file_path);

`;

/** Kept out of SCHEMA: they must be recreated whenever chunks_fts is rebuilt. */
const FTS_TRIGGERS = `
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, content) VALUES ('delete', old.id, old.content);
  INSERT INTO chunks_fts(rowid, content) VALUES (new.id, new.content);
END;
`;

/** Open a database at an explicit path (or ":memory:" for tests) with schema applied. */
export function openDbAt(dbPath: string, tokenizer?: FtsTokenizer): Database {
  initSqlite();
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  // Try to load sqlite-vec. We don't require it (retrieval uses brute-force KNN over
  // BLOBs), but loading it keeps the door open for a future vec0 backend.
  try {
    sqliteVec.load(db);
  } catch {
    /* extension loading unavailable on this platform — brute-force path is unaffected */
  }
  db.exec(SCHEMA);
  syncFtsTokenizer(db, tokenizer ?? ftsTokenizer(process.env.KNOWHIVE_FTS_TOKENIZER));
  migrate(db);
  return db;
}

/**
 * Create the FTS mirror, and REBUILD it if the stored table uses a different
 * tokenizer than the one we want.
 *
 * The rebuild is the load-bearing part. The schema uses CREATE VIRTUAL TABLE IF NOT
 * EXISTS, which is a no-op once the table exists — so without this, an upgrading
 * user would silently keep the old unicode61 index forever and never see the fix.
 * Repopulating from `chunks` means no re-ingest and no re-embedding: the text is
 * already there, only the inverted index is derived.
 */
function syncFtsTokenizer(db: Database, tokenizer: FtsTokenizer): void {
  const row = db.query("SELECT sql FROM sqlite_master WHERE name = 'chunks_fts'").get() as
    | { sql: string }
    | null;
  const wanted = tokenizer === "trigram" ? ", tokenize='trigram'" : "";
  if (row && row.sql.includes("tokenize='trigram'") === (tokenizer === "trigram")) return;

  if (row) {
    // Triggers reference the table; drop them first so the recreate is clean.
    db.exec("DROP TRIGGER IF EXISTS chunks_ai; DROP TRIGGER IF EXISTS chunks_ad; DROP TRIGGER IF EXISTS chunks_au;");
    db.exec("DROP TABLE chunks_fts;");
  }
  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  content,
  content='chunks',
  content_rowid='id'${wanted}
);`);
  db.exec(FTS_TRIGGERS);
  if (row) {
    db.exec("INSERT INTO chunks_fts(rowid, content) SELECT id, content FROM chunks;");
    console.log(`[db] rebuilt chunks_fts with the ${tokenizer} tokenizer`);
  }
}

/** Idempotent column additions for tables that predate Phase M (multi-session chat).
 * CREATE IF NOT EXISTS can't add columns, so existing DBs need ALTERs. */
function migrate(db: Database): void {
  const addColumnIfMissing = (table: string, column: string, ddl: string) => {
    const cols = db.query(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    }
  };
  addColumnIfMissing("chat_messages", "session_id", "session_id TEXT");
  addColumnIfMissing("chat_summaries", "session_id", "session_id TEXT");
  addColumnIfMissing("memories", "last_recalled_at", "last_recalled_at TEXT");
  // Parent-child chunking: pre-existing chunks keep parent_id NULL and simply don't
  // expand at retrieval time, so an un-migrated DB degrades to the old behaviour.
  addColumnIfMissing("chunks", "parent_id", "parent_id INTEGER");
  // Chunk-strategy routing: documents ingested before the router keep NULL until re-ingest.
  addColumnIfMissing("documents", "chunk_strategy", "chunk_strategy TEXT");
}

export function openDb(dataDir: string): Database {
  mkdirSync(dataDir, { recursive: true });
  return openDbAt(join(dataDir, "knowhive.db"));
}

/** Loaded sqlite-vec version, or null if the extension couldn't load on this platform. */
export function vecVersion(db: Database): string | null {
  try {
    const row = db.query("SELECT vec_version() AS v").get() as { v: string } | null;
    return row?.v ?? null;
  } catch {
    return null;
  }
}
