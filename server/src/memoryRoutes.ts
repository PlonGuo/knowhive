// Memory management API (Phase M3): the user can see, edit, and delete what the
// system has learned about them. Episodic traces are excluded from the default
// listing (they're conversation logs, not "learned facts").
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { encodeVector } from "./retrieval.ts";

export interface MemoryRoutesDeps {
  db: Database;
  /** Re-embed edited semantic memories so recall stays consistent. */
  embedFacts: (facts: string[]) => Promise<number[][]>;
}

export function memoryRoutes(deps: MemoryRoutesDeps): Hono {
  const app = new Hono();

  app.get("/memories", (c) => {
    const kind = c.req.query("kind");
    const rows = kind
      ? deps.db
          .query("SELECT id, kind, content, created_at FROM memories WHERE kind = ? ORDER BY id DESC")
          .all(kind)
      : deps.db
          .query(
            "SELECT id, kind, content, created_at FROM memories WHERE kind != 'episodic' ORDER BY id DESC",
          )
          .all();
    return c.json({ memories: rows });
  });

  app.delete("/memories/:id", (c) => {
    deps.db.run("DELETE FROM memories WHERE id = ?", [c.req.param("id")]);
    return c.json({ ok: true });
  });

  app.put("/memories/:id", async (c) => {
    const { content } = (await c.req.json()) as { content?: string };
    if (!content || !content.trim()) {
      return c.json({ error: "content must not be empty" }, 400);
    }
    const id = c.req.param("id");
    const row = deps.db.query("SELECT kind FROM memories WHERE id = ?").get(id) as
      | { kind: string }
      | null;
    if (!row) return c.json({ error: "not found" }, 404);

    // Semantic memories are recalled by embedding — an edit must re-embed.
    const embedding =
      row.kind === "semantic" ? encodeVector((await deps.embedFacts([content]))[0]!) : null;
    if (embedding) {
      deps.db.run("UPDATE memories SET content = ?, embedding = ? WHERE id = ?", [
        content,
        embedding,
        id,
      ]);
    } else {
      deps.db.run("UPDATE memories SET content = ? WHERE id = ?", [content, id]);
    }
    return c.json({ ok: true });
  });

  return app;
}
