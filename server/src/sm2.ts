// SM-2 spaced repetition over the review_items table.
// Ports backend/app/services/spaced_repetition_service.py (+ ReviewItem from models.py).
import type { Database } from "bun:sqlite";

export interface ReviewItem {
  id: number | null;
  file_path: string;
  question: string;
  answer: string;
  repetitions: number;
  easiness: number;
  interval: number;
  due_date: string;
}

/** Python's round() rounds half to even; Math.round rounds half up. Keep parity. */
export function roundHalfToEven(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Apply one SM-2 review cycle (quality 0=blackout … 4=easy). Returns updated item (not persisted). */
export function applySm2(item: ReviewItem, quality: number, today: string): ReviewItem {
  const q = quality;

  // EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02)), floored at 1.3
  const easiness = Math.max(1.3, item.easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));

  let repetitions: number;
  let interval: number;
  if (q < 2) {
    repetitions = 0;
    interval = 1;
  } else {
    repetitions = item.repetitions + 1;
    if (repetitions === 1) interval = 1;
    else if (repetitions === 2) interval = 6;
    else interval = roundHalfToEven(item.interval * easiness);
  }

  return { ...item, repetitions, easiness, interval, due_date: addDays(today, interval) };
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Local date as YYYY-MM-DD (parity with Python's date.today()). */
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addReviewItem(
  db: Database,
  filePath: string,
  question: string,
  answer: string,
  dueDate: string,
): ReviewItem {
  const row = db
    .query(
      `INSERT INTO review_items (file_path, question, answer, due_date)
       VALUES (?, ?, ?, ?) RETURNING id`,
    )
    .get(filePath, question, answer, dueDate) as { id: number };
  return {
    id: row.id,
    file_path: filePath,
    question,
    answer,
    repetitions: 0,
    easiness: 2.5,
    interval: 1,
    due_date: dueDate,
  };
}

export function getDueItems(db: Database, today: string): ReviewItem[] {
  return db
    .query(
      `SELECT id, file_path, question, answer, repetitions, easiness, interval, due_date
       FROM review_items WHERE due_date <= ? ORDER BY due_date`,
    )
    .all(today) as unknown as ReviewItem[];
}

/** Apply SM-2 to a stored item and persist. Returns null if the item doesn't exist. */
export function recordReview(db: Database, itemId: number, quality: number, today: string): ReviewItem | null {
  const item = db
    .query(
      `SELECT id, file_path, question, answer, repetitions, easiness, interval, due_date
       FROM review_items WHERE id = ?`,
    )
    .get(itemId) as ReviewItem | null;
  if (!item) return null;

  const updated = applySm2(item, quality, today);
  db.run(
    `UPDATE review_items SET repetitions=?, easiness=?, interval=?, due_date=?, updated_at=datetime('now')
     WHERE id=?`,
    [updated.repetitions, updated.easiness, updated.interval, updated.due_date, itemId],
  );
  return updated;
}

export function getReviewStats(db: Database, today: string): { total: number; due_today: number } {
  const total = (db.query("SELECT COUNT(*) AS c FROM review_items").get() as { c: number }).c;
  const due = (
    db.query("SELECT COUNT(*) AS c FROM review_items WHERE due_date <= ?").get(today) as { c: number }
  ).c;
  return { total, due_today: due };
}
