"""Tests for SpacedRepetitionService — SM-2 algorithm, due items, record review."""
from datetime import date, timedelta

import pytest
import pytest_asyncio

from app.database import close_db, init_db
from app.models import ReviewItem, ReviewQuality
from app.services.spaced_repetition_service import SpacedRepetitionService


@pytest_asyncio.fixture
async def db(tmp_path):
    db_file = str(tmp_path / "test.db")
    await init_db(db_file)
    yield
    await close_db()


@pytest_asyncio.fixture
async def svc(db):
    return SpacedRepetitionService()


# ── SM-2 algorithm ────────────────────────────────────────────────────────────

def test_sm2_easy_increases_interval():
    svc = SpacedRepetitionService()
    # repetitions=2 means 2 successful reviews done — next interval uses I*EF formula
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=2, easiness=2.5, interval=6)
    updated = svc.apply_sm2(item, ReviewQuality.EASY)
    assert updated.interval > 6


def test_sm2_good_keeps_or_increases_interval():
    svc = SpacedRepetitionService()
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=3, easiness=2.5, interval=15)
    updated = svc.apply_sm2(item, ReviewQuality.GOOD)
    assert updated.interval >= 15


def test_sm2_blackout_resets_repetitions():
    svc = SpacedRepetitionService()
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=5, easiness=2.5, interval=30)
    updated = svc.apply_sm2(item, ReviewQuality.BLACKOUT)
    assert updated.repetitions == 0
    assert updated.interval == 1


def test_sm2_incorrect_resets_repetitions():
    svc = SpacedRepetitionService()
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=3, easiness=2.5, interval=15)
    updated = svc.apply_sm2(item, ReviewQuality.INCORRECT)
    assert updated.repetitions == 0
    assert updated.interval == 1


def test_sm2_updates_easiness():
    svc = SpacedRepetitionService()
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=2, easiness=2.5, interval=6)
    updated = svc.apply_sm2(item, ReviewQuality.HARD)
    # Hard quality should decrease easiness
    assert updated.easiness < 2.5


def test_sm2_easiness_never_below_1_3():
    svc = SpacedRepetitionService()
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=2, easiness=1.3, interval=3)
    updated = svc.apply_sm2(item, ReviewQuality.BLACKOUT)
    assert updated.easiness >= 1.3


def test_sm2_updates_due_date():
    svc = SpacedRepetitionService()
    item = ReviewItem(file_path="f.md", question="Q", answer="A", repetitions=2, easiness=2.5, interval=6)
    updated = svc.apply_sm2(item, ReviewQuality.GOOD)
    today = date.today()
    expected_due = (today + timedelta(days=updated.interval)).isoformat()
    assert updated.due_date == expected_due


# ── add_item / get_due_items / record_review ──────────────────────────────────

@pytest.mark.asyncio
async def test_add_item_returns_review_item_with_id(svc):
    item = await svc.add_item("packs/python/intro.md", "What is a list?", "An ordered sequence.")
    assert item.id is not None
    assert item.question == "What is a list?"


@pytest.mark.asyncio
async def test_get_due_items_returns_items_due_today(svc):
    await svc.add_item("packs/python/intro.md", "What is a list?", "An ordered sequence.")
    due = await svc.get_due_items()
    assert len(due) == 1


@pytest.mark.asyncio
async def test_get_due_items_excludes_future_items(svc):
    # Add item due far in the future
    from app.database import get_db
    future = (date.today() + timedelta(days=10)).isoformat()
    async with get_db() as conn:
        await conn.execute(
            "INSERT INTO review_items (file_path, question, answer, due_date) VALUES (?, ?, ?, ?)",
            ("f.md", "Q?", "A.", future),
        )
        await conn.commit()
    due = await svc.get_due_items()
    assert len(due) == 0


@pytest.mark.asyncio
async def test_record_review_updates_due_date(svc):
    item = await svc.add_item("packs/python/intro.md", "Q?", "A.")
    assert item.id is not None
    updated = await svc.record_review(item.id, ReviewQuality.EASY)
    # After easy review, due date should be in the future
    assert updated.due_date > date.today().isoformat()


@pytest.mark.asyncio
async def test_record_review_raises_for_missing_item(svc):
    with pytest.raises(ValueError, match="not found"):
        await svc.record_review(99999, ReviewQuality.GOOD)


@pytest.mark.asyncio
async def test_get_stats_returns_total_and_due(svc):
    await svc.add_item("f.md", "Q1?", "A1.")
    await svc.add_item("f.md", "Q2?", "A2.")
    stats = await svc.get_stats()
    assert stats["total"] == 2
    assert stats["due_today"] == 2
