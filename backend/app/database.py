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
"""


async def init_db(db_path: str = "knowhive.db") -> None:
    """Initialize the database connection and create tables."""
    global _db_path, _connection
    _db_path = db_path
    _connection = await aiosqlite.connect(db_path)
    _connection.row_factory = aiosqlite.Row
    await _connection.executescript(SQL_CREATE_TABLES)
    await _connection.commit()


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
