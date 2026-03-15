"""Async SQLite connection manager for KnowHive."""
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

import aiosqlite

_db_path: str = "knowhive.db"
_connection: Optional[aiosqlite.Connection] = None

SQL_CREATE_TABLES = """
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

CREATE TABLE IF NOT EXISTS summaries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL UNIQUE,
    summary         TEXT NOT NULL,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
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
"""


_MIGRATION_COLUMNS = [
    ("title", "TEXT"),
    ("category", "TEXT"),
    ("tags", "TEXT"),
    ("difficulty", "TEXT"),
    ("pack_id", "TEXT"),
]


async def _migrate_documents_table(conn: aiosqlite.Connection) -> None:
    """Add frontmatter columns to documents table if they don't exist."""
    cursor = await conn.execute("PRAGMA table_info(documents)")
    existing = {row[1] for row in await cursor.fetchall()}
    for col_name, col_type in _MIGRATION_COLUMNS:
        if col_name not in existing:
            await conn.execute(
                f"ALTER TABLE documents ADD COLUMN {col_name} {col_type}"
            )
    await conn.commit()


async def init_db(db_path: str = "knowhive.db") -> None:
    """Initialize the database connection and create tables."""
    global _db_path, _connection
    _db_path = db_path
    _connection = await aiosqlite.connect(db_path)
    _connection.row_factory = aiosqlite.Row
    await _connection.executescript(SQL_CREATE_TABLES)
    await _connection.commit()
    await _migrate_documents_table(_connection)


async def close_db() -> None:
    """Close the database connection."""
    global _connection
    if _connection is not None:
        await _connection.close()
        _connection = None


@asynccontextmanager
async def get_db() -> AsyncGenerator[aiosqlite.Connection, None]:
    """Get the active database connection as a context manager."""
    if _connection is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    yield _connection
