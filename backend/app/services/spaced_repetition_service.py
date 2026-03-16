"""SpacedRepetitionService — SM-2 flashcard scheduling."""
from datetime import date, timedelta

from app.database import get_db
from app.models import ReviewItem, ReviewQuality


class SpacedRepetitionService:
    """Implements SM-2 spaced repetition algorithm for knowledge review."""

    def apply_sm2(self, item: ReviewItem, quality: ReviewQuality) -> ReviewItem:
        """Apply one SM-2 review cycle. Returns updated item (not persisted)."""
        q = int(quality)

        # Update easiness factor: EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02))
        new_easiness = item.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        new_easiness = max(1.3, new_easiness)

        if q < 2:
            # Failed recall — reset
            new_repetitions = 0
            new_interval = 1
        else:
            new_repetitions = item.repetitions + 1
            if new_repetitions == 1:
                new_interval = 1
            elif new_repetitions == 2:
                new_interval = 6
            else:
                new_interval = round(item.interval * new_easiness)

        new_due = (date.today() + timedelta(days=new_interval)).isoformat()

        return item.model_copy(update={
            "repetitions": new_repetitions,
            "easiness": new_easiness,
            "interval": new_interval,
            "due_date": new_due,
        })

    async def add_item(self, file_path: str, question: str, answer: str) -> ReviewItem:
        """Insert a new review item into the DB."""
        due_date = date.today().isoformat()
        async with get_db() as conn:
            cursor = await conn.execute(
                """INSERT INTO review_items (file_path, question, answer, due_date)
                   VALUES (?, ?, ?, ?)""",
                (file_path, question, answer, due_date),
            )
            await conn.commit()
            row_id = cursor.lastrowid

        return ReviewItem(
            id=row_id,
            file_path=file_path,
            question=question,
            answer=answer,
            due_date=due_date,
        )

    async def get_due_items(self) -> list[ReviewItem]:
        """Return all items due today or earlier."""
        today = date.today().isoformat()
        async with get_db() as conn:
            cursor = await conn.execute(
                "SELECT * FROM review_items WHERE due_date <= ? ORDER BY due_date",
                (today,),
            )
            rows = await cursor.fetchall()
        return [ReviewItem(**dict(row)) for row in rows]

    async def record_review(self, item_id: int, quality: ReviewQuality) -> ReviewItem:
        """Apply SM-2 to an item and persist the update."""
        async with get_db() as conn:
            cursor = await conn.execute(
                "SELECT * FROM review_items WHERE id = ?", (item_id,)
            )
            row = await cursor.fetchone()
            if row is None:
                raise ValueError(f"ReviewItem {item_id} not found")

            item = ReviewItem(**dict(row))
            updated = self.apply_sm2(item, quality)

            await conn.execute(
                """UPDATE review_items
                   SET repetitions=?, easiness=?, interval=?, due_date=?,
                       updated_at=datetime('now')
                   WHERE id=?""",
                (updated.repetitions, updated.easiness, updated.interval, updated.due_date, item_id),
            )
            await conn.commit()

        return updated.model_copy(update={"id": item_id})

    async def get_stats(self) -> dict[str, int]:
        """Return total items and due-today count."""
        today = date.today().isoformat()
        async with get_db() as conn:
            cursor = await conn.execute("SELECT COUNT(*) FROM review_items")
            total_row = await cursor.fetchone()
            cursor = await conn.execute(
                "SELECT COUNT(*) FROM review_items WHERE due_date <= ?", (today,)
            )
            due_row = await cursor.fetchone()
        return {"total": total_row[0], "due_today": due_row[0]}
