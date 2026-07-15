// Chat session HTTP API (Phase M): list/create/read/delete conversations.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { createSession, deleteSession, getMessages, listSessions } from "./sessions.ts";

export interface SessionRoutesDeps {
  db: Database;
}

export function sessionRoutes(deps: SessionRoutesDeps): Hono {
  const app = new Hono();

  app.post("/sessions", (c) => c.json({ id: createSession(deps.db) }));

  app.get("/sessions", (c) => c.json({ sessions: listSessions(deps.db) }));

  app.get("/sessions/:id/messages", (c) =>
    c.json({ messages: getMessages(deps.db, c.req.param("id")) }),
  );

  app.delete("/sessions/:id", (c) => {
    deleteSession(deps.db, c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}
