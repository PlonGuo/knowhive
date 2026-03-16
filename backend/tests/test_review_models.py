"""Tests for review_items DB table + SM-2 models."""
import pytest
import pytest_asyncio

from app.database import close_db, get_db, init_db
from app.models import ReviewItem, ReviewQuality


# ── ReviewQuality enum ────────────────────────────────────────────────────────

def test_review_quality_has_five_values():
    values = list(ReviewQuality)
    assert len(values) == 5


def test_review_quality_values_are_0_to_4():
    assert ReviewQuality.BLACKOUT.value == 0
    assert ReviewQuality.INCORRECT.value == 1
    assert ReviewQuality.HARD.value == 2
    assert ReviewQuality.GOOD.value == 3
    assert ReviewQuality.EASY.value == 4


# ── ReviewItem model ──────────────────────────────────────────────────────────

def test_review_item_has_sm2_fields():
    item = ReviewItem(
        file_path="packs/python/intro.md",
        question="What is a list?",
        answer="An ordered mutable sequence.",
    )
    assert item.repetitions == 0
    assert item.easiness == 2.5
    assert item.interval == 1
    assert item.due_date is not None
    assert item.file_path == "packs/python/intro.md"
    assert item.question == "What is a list?"
    assert item.answer == "An ordered mutable sequence."


def test_review_item_defaults_to_due_today():
    from datetime import date
    item = ReviewItem(file_path="f.md", question="Q?", answer="A.")
    assert item.due_date == date.today().isoformat()


def test_review_item_id_is_none_by_default():
    item = ReviewItem(file_path="f.md", question="Q?", answer="A.")
    assert item.id is None


# ── DB table creation ─────────────────────────────────────────────────────────

@pytest_asyncio.fixture
async def db(tmp_path):
    db_file = str(tmp_path / "test.db")
    await init_db(db_file)
    yield
    await close_db()


@pytest.mark.asyncio
async def test_review_items_table_exists(db):
    async with get_db() as conn:
        cursor = await conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='review_items'"
        )
        row = await cursor.fetchone()
    assert row is not None


@pytest.mark.asyncio
async def test_review_items_table_has_sm2_columns(db):
    async with get_db() as conn:
        cursor = await conn.execute("PRAGMA table_info(review_items)")
        cols = {row[1] async for row in cursor}
    expected = {"id", "file_path", "question", "answer", "repetitions", "easiness", "interval", "due_date", "created_at", "updated_at"}
    assert expected.issubset(cols)


@pytest.mark.asyncio
async def test_can_insert_review_item(db):
    from datetime import date
    async with get_db() as conn:
        await conn.execute(
            """INSERT INTO review_items (file_path, question, answer, due_date)
               VALUES (?, ?, ?, ?)""",
            ("packs/test/intro.md", "What is Python?", "A programming language.", date.today().isoformat()),
        )
        await conn.commit()
        cursor = await conn.execute("SELECT COUNT(*) FROM review_items")
        row = await cursor.fetchone()
    assert row[0] == 1
