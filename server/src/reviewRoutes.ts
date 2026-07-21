// Review endpoints: GET /review/due, POST /review/record, GET /review/stats.
// Ports backend/app/routers/review.py.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDueItems, getReviewStats, localToday, recordReview } from "./sm2.ts";

export interface ReviewRoutesDeps {
  db: Database;
  /** Local-date provider (ISO YYYY-MM-DD); injectable for tests. */
  today?: () => string;
}

export function reviewRoutes(deps: ReviewRoutesDeps): Hono {
  const app = new Hono();
  const today = deps.today ?? localToday;

  app.get("/review/due", (c) => c.json(getDueItems(deps.db, today())));

  app.post("/review/record", async (c) => {
    const { item_id, quality } = (await c.req.json()) as { item_id: number; quality: number };
    if (!Number.isInteger(quality) || quality < 0 || quality > 4) {
      return c.json({ detail: `Invalid quality value: ${quality}. Must be 0-4.` }, 422);
    }
    const updated = recordReview(deps.db, item_id, quality, today());
    if (!updated) return c.json({ detail: `ReviewItem ${item_id} not found` }, 404);
    return c.json(updated);
  });

  app.get("/review/stats", (c) => c.json(getReviewStats(deps.db, today())));

  return app;
}
