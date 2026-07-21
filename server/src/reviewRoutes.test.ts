import { test, expect } from "bun:test";
import { Hono } from "hono";
import { openDbAt } from "./db.ts";
import { addReviewItem } from "./sm2.ts";
import { reviewRoutes } from "./reviewRoutes.ts";

// Parity tests against backend/app/routers/review.py + the db half of
// spaced_repetition_service.py (add/get_due/record/stats).

const TODAY = "2026-07-02";

function setup() {
  const db = openDbAt(":memory:");
  const app = new Hono().route("/", reviewRoutes({ db, today: () => TODAY }));
  return { db, app };
}

test("GET /review/due returns items due today or earlier, ordered by due date", async () => {
  const { db, app } = setup();
  addReviewItem(db, "a.md", "Q1", "A1", "2026-07-01");
  addReviewItem(db, "b.md", "Q2", "A2", TODAY);
  addReviewItem(db, "c.md", "Q3", "A3", "2026-07-09");

  const res = await app.request("/review/due");
  expect(res.status).toBe(200);
  const items = await res.json();
  expect(items.map((i: { question: string }) => i.question)).toEqual(["Q1", "Q2"]);
  expect(items[0]).toEqual({
    id: 1,
    file_path: "a.md",
    question: "Q1",
    answer: "A1",
    repetitions: 0,
    easiness: 2.5,
    interval: 1,
    due_date: "2026-07-01",
  });
});

test("POST /review/record applies SM-2 and persists the update", async () => {
  const { db, app } = setup();
  addReviewItem(db, "a.md", "Q1", "A1", TODAY);
  const res = await app.request("/review/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ item_id: 1, quality: 3 }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.repetitions).toBe(1);
  expect(body.interval).toBe(1);
  expect(body.due_date).toBe("2026-07-03");
  const row = db.query("SELECT repetitions, due_date FROM review_items WHERE id = 1").get() as {
    repetitions: number;
    due_date: string;
  };
  expect(row).toEqual({ repetitions: 1, due_date: "2026-07-03" });
});

test("POST /review/record rejects out-of-range quality with 422 and unknown items with 404", async () => {
  const { db, app } = setup();
  addReviewItem(db, "a.md", "Q1", "A1", TODAY);
  const post = (body: unknown) =>
    app.request("/review/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await post({ item_id: 1, quality: 5 })).status).toBe(422);
  expect((await post({ item_id: 1, quality: -1 })).status).toBe(422);
  expect((await post({ item_id: 99, quality: 3 })).status).toBe(404);
});

test("GET /review/stats returns total and due-today counts", async () => {
  const { db, app } = setup();
  addReviewItem(db, "a.md", "Q1", "A1", "2026-07-01");
  addReviewItem(db, "b.md", "Q2", "A2", "2026-07-09");
  const res = await app.request("/review/stats");
  expect(await res.json()).toEqual({ total: 2, due_today: 1 });
});
