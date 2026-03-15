"""Tests for SQLite database setup — documents, chat_messages, ingest_tasks tables."""
import asyncio
from datetime import datetime

import pytest
import pytest_asyncio

from app.database import get_db, init_db, close_db
from app.models import (
    Document,
    DocumentCreate,
    DocumentStatus,
    ChatMessage,
    ChatMessageCreate,
    ChatMessageRole,
    IngestTask,
    IngestTaskCreate,
    IngestTaskStatus,
)


@pytest_asyncio.fixture
async def db():
    """Create an in-memory database for testing."""
    await init_db(":memory:")
    async with get_db() as conn:
        yield conn
    await close_db()


# ── Table creation ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_documents_table_exists(db):
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='documents'"
    )
    row = await cursor.fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_chat_messages_table_exists(db):
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='chat_messages'"
    )
    row = await cursor.fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_ingest_tasks_table_exists(db):
    cursor = await db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='ingest_tasks'"
    )
    row = await cursor.fetchone()
    assert row is not None


# ── Documents CRUD ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_insert_and_read_document(db):
    await db.execute(
        """INSERT INTO documents (file_path, file_name, file_size, file_hash, modified_at, status)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("/docs/readme.md", "readme.md", 1234, "abc123", "2026-01-01T00:00:00", "pending"),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM documents WHERE file_path = ?", ("/docs/readme.md",))
    row = await cursor.fetchone()
    assert row is not None
    assert row["file_name"] == "readme.md"
    assert row["file_size"] == 1234
    assert row["status"] == "pending"


@pytest.mark.asyncio
async def test_document_file_path_unique(db):
    await db.execute(
        """INSERT INTO documents (file_path, file_name, modified_at)
           VALUES (?, ?, ?)""",
        ("/docs/a.md", "a.md", "2026-01-01T00:00:00"),
    )
    await db.commit()

    with pytest.raises(Exception):  # IntegrityError
        await db.execute(
            """INSERT INTO documents (file_path, file_name, modified_at)
               VALUES (?, ?, ?)""",
            ("/docs/a.md", "a.md", "2026-01-01T00:00:00"),
        )
        await db.commit()


@pytest.mark.asyncio
async def test_document_defaults(db):
    await db.execute(
        """INSERT INTO documents (file_path, file_name, modified_at)
           VALUES (?, ?, ?)""",
        ("/docs/b.md", "b.md", "2026-01-01T00:00:00"),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM documents WHERE file_path = ?", ("/docs/b.md",))
    row = await cursor.fetchone()
    assert row["chunk_count"] == 0
    assert row["status"] == "pending"
    assert row["created_at"] is not None


# ── Chat Messages CRUD ──────────────────────────────────────────


@pytest.mark.asyncio
async def test_insert_and_read_chat_message(db):
    await db.execute(
        """INSERT INTO chat_messages (role, content, sources) VALUES (?, ?, ?)""",
        ("user", "Hello!", None),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM chat_messages WHERE role = 'user'")
    row = await cursor.fetchone()
    assert row is not None
    assert row["content"] == "Hello!"
    assert row["created_at"] is not None


@pytest.mark.asyncio
async def test_chat_message_with_sources(db):
    import json

    sources = json.dumps([{"file": "readme.md", "chunk": 0}])
    await db.execute(
        """INSERT INTO chat_messages (role, content, sources) VALUES (?, ?, ?)""",
        ("assistant", "Here is the answer.", sources),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM chat_messages ORDER BY id DESC LIMIT 1")
    row = await cursor.fetchone()
    parsed = json.loads(row["sources"])
    assert len(parsed) == 1
    assert parsed[0]["file"] == "readme.md"


# ── Ingest Tasks CRUD ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_insert_and_read_ingest_task(db):
    await db.execute(
        """INSERT INTO ingest_tasks (id, status, total_files) VALUES (?, ?, ?)""",
        ("task-uuid-1", "pending", 5),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM ingest_tasks WHERE id = ?", ("task-uuid-1",))
    row = await cursor.fetchone()
    assert row is not None
    assert row["total_files"] == 5
    assert row["status"] == "pending"


@pytest.mark.asyncio
async def test_ingest_task_update_progress(db):
    await db.execute(
        """INSERT INTO ingest_tasks (id, status, total_files, processed_files) VALUES (?, ?, ?, ?)""",
        ("task-uuid-2", "running", 10, 0),
    )
    await db.commit()

    await db.execute(
        """UPDATE ingest_tasks SET processed_files = ?, status = ? WHERE id = ?""",
        (10, "completed", "task-uuid-2"),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM ingest_tasks WHERE id = ?", ("task-uuid-2",))
    row = await cursor.fetchone()
    assert row["processed_files"] == 10
    assert row["status"] == "completed"


# ── Pydantic models ─────────────────────────────────────────────


def test_document_create_model():
    doc = DocumentCreate(
        file_path="/docs/readme.md",
        file_name="readme.md",
        file_size=1234,
        file_hash="abc123",
        modified_at="2026-01-01T00:00:00",
    )
    assert doc.file_path == "/docs/readme.md"
    assert doc.file_size == 1234


def test_document_model():
    doc = Document(
        id=1,
        file_path="/docs/readme.md",
        file_name="readme.md",
        file_size=1234,
        file_hash="abc123",
        modified_at="2026-01-01T00:00:00",
        indexed_at=None,
        chunk_count=0,
        status=DocumentStatus.PENDING,
        error_message=None,
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
    )
    assert doc.id == 1
    assert doc.status == DocumentStatus.PENDING


def test_document_status_enum():
    assert DocumentStatus.PENDING == "pending"
    assert DocumentStatus.INDEXED == "indexed"
    assert DocumentStatus.ERROR == "error"


def test_chat_message_create_model():
    msg = ChatMessageCreate(role=ChatMessageRole.USER, content="Hello!")
    assert msg.role == ChatMessageRole.USER


def test_chat_message_model():
    msg = ChatMessage(
        id=1,
        role=ChatMessageRole.ASSISTANT,
        content="Answer",
        sources='[{"file":"a.md"}]',
        created_at="2026-01-01T00:00:00",
    )
    assert msg.id == 1
    assert msg.role == ChatMessageRole.ASSISTANT


def test_ingest_task_create_model():
    task = IngestTaskCreate(id="uuid-1", total_files=5)
    assert task.total_files == 5
    assert task.status == IngestTaskStatus.PENDING


def test_ingest_task_model():
    task = IngestTask(
        id="uuid-1",
        status=IngestTaskStatus.RUNNING,
        total_files=10,
        processed_files=3,
        errors=None,
        created_at="2026-01-01T00:00:00",
        completed_at=None,
    )
    assert task.processed_files == 3
    assert task.status == IngestTaskStatus.RUNNING


def test_ingest_task_status_enum():
    assert IngestTaskStatus.PENDING == "pending"
    assert IngestTaskStatus.RUNNING == "running"
    assert IngestTaskStatus.COMPLETED == "completed"
    assert IngestTaskStatus.FAILED == "failed"


# ── Schema migration — frontmatter columns ─────────────────────


@pytest.mark.asyncio
async def test_documents_has_title_column(db):
    """documents table should have a title column (nullable)."""
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = {row[1] for row in await cursor.fetchall()}
    assert "title" in columns


@pytest.mark.asyncio
async def test_documents_has_category_column(db):
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = {row[1] for row in await cursor.fetchall()}
    assert "category" in columns


@pytest.mark.asyncio
async def test_documents_has_tags_column(db):
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = {row[1] for row in await cursor.fetchall()}
    assert "tags" in columns


@pytest.mark.asyncio
async def test_documents_has_difficulty_column(db):
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = {row[1] for row in await cursor.fetchall()}
    assert "difficulty" in columns


@pytest.mark.asyncio
async def test_documents_has_pack_id_column(db):
    cursor = await db.execute("PRAGMA table_info(documents)")
    columns = {row[1] for row in await cursor.fetchall()}
    assert "pack_id" in columns


@pytest.mark.asyncio
async def test_frontmatter_columns_default_null(db):
    """New frontmatter columns should default to NULL for existing rows."""
    await db.execute(
        """INSERT INTO documents (file_path, file_name, modified_at)
           VALUES (?, ?, ?)""",
        ("/docs/plain.md", "plain.md", "2026-01-01T00:00:00"),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM documents WHERE file_path = ?", ("/docs/plain.md",))
    row = await cursor.fetchone()
    assert row["title"] is None
    assert row["category"] is None
    assert row["tags"] is None
    assert row["difficulty"] is None
    assert row["pack_id"] is None


@pytest.mark.asyncio
async def test_insert_document_with_frontmatter(db):
    """Can insert a document with all frontmatter fields populated."""
    await db.execute(
        """INSERT INTO documents (file_path, file_name, modified_at, title, category, tags, difficulty, pack_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        ("/docs/two-sum.md", "two-sum.md", "2026-01-01T00:00:00",
         "Two Sum", "arrays", "easy,hash-table", "easy", "leetcode-basics"),
    )
    await db.commit()

    cursor = await db.execute("SELECT * FROM documents WHERE file_path = ?", ("/docs/two-sum.md",))
    row = await cursor.fetchone()
    assert row["title"] == "Two Sum"
    assert row["category"] == "arrays"
    assert row["tags"] == "easy,hash-table"
    assert row["difficulty"] == "easy"
    assert row["pack_id"] == "leetcode-basics"


@pytest.mark.asyncio
async def test_migration_idempotent(db):
    """Calling init_db twice should not fail (migration is safe to re-run)."""
    # init_db was already called by the fixture; call it again
    await init_db(":memory:")
    async with get_db() as conn:
        cursor = await conn.execute("PRAGMA table_info(documents)")
        columns = {row[1] for row in await cursor.fetchall()}
        assert "title" in columns
        assert "pack_id" in columns
    await close_db()


# ── Pydantic model — frontmatter fields ────────────────────────


def test_document_create_with_frontmatter():
    doc = DocumentCreate(
        file_path="/docs/two-sum.md",
        file_name="two-sum.md",
        modified_at="2026-01-01T00:00:00",
        title="Two Sum",
        category="arrays",
        tags="easy,hash-table",
        difficulty="easy",
        pack_id="leetcode-basics",
    )
    assert doc.title == "Two Sum"
    assert doc.pack_id == "leetcode-basics"


def test_document_create_frontmatter_defaults_none():
    doc = DocumentCreate(
        file_path="/docs/plain.md",
        file_name="plain.md",
        modified_at="2026-01-01T00:00:00",
    )
    assert doc.title is None
    assert doc.category is None
    assert doc.tags is None
    assert doc.difficulty is None
    assert doc.pack_id is None


def test_document_model_with_frontmatter():
    doc = Document(
        id=1,
        file_path="/docs/two-sum.md",
        file_name="two-sum.md",
        modified_at="2026-01-01T00:00:00",
        created_at="2026-01-01T00:00:00",
        updated_at="2026-01-01T00:00:00",
        title="Two Sum",
        category="arrays",
        tags="easy,hash-table",
        difficulty="easy",
        pack_id="leetcode-basics",
    )
    assert doc.title == "Two Sum"
    assert doc.difficulty == "easy"
