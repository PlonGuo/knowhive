// Chat session storage (Phase M): sessions + per-session messages over the
// chat_messages/chat_summaries tables (schema predates this feature; migrate()
// in db.ts adds the session_id dimension).
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { selectEvictions, type EvictionPolicy } from "./memory.ts";
import { cosineSimilarity, decodeVector } from "./retrieval.ts";

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

/** Brute-force cosine recall over semantic memories (same pattern as chunk KNN —
 * a personal KB accumulates at most thousands of facts, exact scan is sub-ms). */
export function recallSemanticMemories(
  db: Database,
  queryVector: ArrayLike<number>,
  { k, minSimilarity }: { k: number; minSimilarity: number },
): string[] {
  const rows = db
    .query("SELECT id, content, embedding FROM memories WHERE kind = 'semantic' AND embedding IS NOT NULL")
    .all() as { id: number; content: string; embedding: Uint8Array }[];
  const hits = rows
    .map((r) => ({ id: r.id, content: r.content, score: cosineSimilarity(queryVector, decodeVector(r.embedding)) }))
    .filter((r) => r.score >= minSimilarity)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
  // Recall keeps a memory alive under the LRU eviction policy.
  for (const h of hits) {
    db.run("UPDATE memories SET last_recalled_at = datetime('now') WHERE id = ?", [h.id]);
  }
  return hits.map((r) => r.content);
}

export interface EpisodicHit {
  question: string;
  answer: string;
  when: string;
}

/** Keyword search over episodic traces (agent search_history tool, Phase M3).
 * LIKE is enough at personal scale; traces store {question, answer, sources} JSON. */
export function searchEpisodic(db: Database, query: string, limit: number): EpisodicHit[] {
  const rows = db
    .query(
      "SELECT content, created_at FROM memories WHERE kind = 'episodic' AND content LIKE ? ORDER BY id DESC LIMIT ?",
    )
    .all(`%${query}%`, limit) as { content: string; created_at: string }[];
  return rows.flatMap((r) => {
    try {
      const t = JSON.parse(r.content) as { question?: string; answer?: string };
      return [{ question: t.question ?? "", answer: t.answer ?? "", when: r.created_at }];
    } catch {
      return [];
    }
  });
}

/** Apply the eviction policy (Phase M3): run at startup and after distillation. */
export function runEviction(db: Database, policy: EvictionPolicy, now = new Date()): number {
  const rows = db
    .query("SELECT id, kind, created_at, last_recalled_at FROM memories")
    .all() as Array<{ id: number; kind: string; created_at: string; last_recalled_at: string | null }>;
  const ids = selectEvictions(rows, policy, now);
  for (const id of ids) db.run("DELETE FROM memories WHERE id = ?", [id]);
  if (ids.length > 0) console.log(`[memory] evicted ${ids.length} memories`);
  return ids.length;
}

export function deleteSession(db: Database, sessionId: string): void {
  db.run("DELETE FROM chat_messages WHERE session_id = ?", [sessionId]);
  db.run("DELETE FROM chat_summaries WHERE session_id = ?", [sessionId]);
  db.run("DELETE FROM memories WHERE session_id = ? AND kind = 'episodic'", [sessionId]);
  db.run("DELETE FROM sessions WHERE id = ?", [sessionId]);
}
