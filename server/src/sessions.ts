// Chat session storage (Phase M): sessions + per-session messages over the
// chat_messages/chat_summaries tables (schema predates this feature; migrate()
// in db.ts adds the session_id dimension).
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export interface SessionRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface MessageRow {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: string[];
  created_at: string;
}

export function createSession(db: Database): string {
  const id = randomUUID();
  db.run("INSERT INTO sessions (id) VALUES (?)", [id]);
  return id;
}

export function listSessions(db: Database): SessionRow[] {
  return db
    .query("SELECT id, title, created_at, updated_at FROM sessions ORDER BY updated_at DESC")
    .all() as SessionRow[];
}

/** First user message becomes the title; later calls never overwrite. */
export function setSessionTitle(db: Database, sessionId: string, title: string): void {
  db.run("UPDATE sessions SET title = ? WHERE id = ? AND (title = '' OR title IS NULL)", [
    title,
    sessionId,
  ]);
}

export function appendMessage(
  db: Database,
  sessionId: string,
  msg: { role: "user" | "assistant"; content: string; sources?: string[] },
): number {
  db.run("INSERT INTO chat_messages (role, content, sources, session_id) VALUES (?, ?, ?, ?)", [
    msg.role,
    msg.content,
    JSON.stringify(msg.sources ?? []),
    sessionId,
  ]);
  db.run("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?", [sessionId]);
  const row = db.query("SELECT last_insert_rowid() AS id").get() as { id: number };
  return row.id;
}

export function getMessages(db: Database, sessionId: string): MessageRow[] {
  const rows = db
    .query(
      "SELECT id, role, content, sources, created_at FROM chat_messages WHERE session_id = ? ORDER BY id",
    )
    .all(sessionId) as Array<Omit<MessageRow, "sources"> & { sources: string | null }>;
  return rows.map((r) => ({ ...r, sources: r.sources ? (JSON.parse(r.sources) as string[]) : [] }));
}

export function deleteSession(db: Database, sessionId: string): void {
  db.run("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
  db.run("DELETE FROM chat_summaries WHERE session_id = ?", [sessionId]);
  db.run("DELETE FROM memories WHERE session_id = ? AND kind = 'episodic'", [sessionId]);
  db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}
