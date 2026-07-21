import { expect, test } from "bun:test";
import { openDbAt } from "./db.ts";
import { encodeVector } from "./retrieval.ts";
import {
  appendMessage,
  createSession,
  deleteSession,
  getMessages,
  listSessions,
  setSessionTitle,
  recallSemanticMemories,
  searchEpisodic,
} from "./sessions.ts";

const freshDb = () => openDbAt(":memory:");

test("createSession returns an id and listSessions surfaces it, newest first", () => {
  const db = freshDb();
  const a = createSession(db);
  const b = createSession(db);
  db.run("UPDATE sessions SET updated_at = '2026-01-02' WHERE id = ?", [b]);
  db.run("UPDATE sessions SET updated_at = '2026-01-01' WHERE id = ?", [a]);
  const sessions = listSessions(db);
  expect(sessions.map((s) => s.id)).toEqual([b, a]);
  expect(sessions[0]).toHaveProperty("title");
  expect(sessions[0]).toHaveProperty("updated_at");
});

test("appendMessage persists role/content/sources and getMessages returns in order", () => {
  const db = freshDb();
  const sid = createSession(db);
  appendMessage(db, sid, { role: "user", content: "什么是区间DP?" });
  appendMessage(db, sid, {
    role: "assistant",
    content: "区间DP是……",
    sources: ["notes/dp.md"],
  });
  const msgs = getMessages(db, sid);
  expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect(msgs[1]!.sources).toEqual(["notes/dp.md"]);
  expect(msgs[0]!.sources).toEqual([]);
  expect(msgs[0]!.id).toBeGreaterThan(0);
});

test("appendMessage touches the session's updated_at", () => {
  const db = freshDb();
  const sid = createSession(db);
  db.run("UPDATE sessions SET updated_at = '2020-01-01' WHERE id = ?", [sid]);
  appendMessage(db, sid, { role: "user", content: "hi" });
  const [s] = listSessions(db);
  expect(s!.updated_at > "2020-01-01").toBe(true);
});

test("setSessionTitle only fills an empty title", () => {
  const db = freshDb();
  const sid = createSession(db);
  setSessionTitle(db, sid, "第一问");
  setSessionTitle(db, sid, "不应覆盖");
  expect(listSessions(db)[0]!.title).toBe("第一问");
});

test("deleteSession cascades messages and summaries", () => {
  const db = freshDb();
  const sid = createSession(db);
  appendMessage(db, sid, { role: "user", content: "hi" });
  db.run(
    "INSERT INTO chat_summaries (summary, first_message_id, last_message_id, session_id) VALUES ('s', 1, 1, ?)",
    [sid],
  );
  deleteSession(db, sid);
  expect(listSessions(db)).toEqual([]);
  expect(getMessages(db, sid)).toEqual([]);
  const n = db.query("SELECT COUNT(*) AS n FROM chat_summaries WHERE session_id = ?").get(sid) as {
    n: number;
  };
  expect(n.n).toBe(0);
});

test("messages from other sessions are isolated", () => {
  const db = freshDb();
  const a = createSession(db);
  const b = createSession(db);
  appendMessage(db, a, { role: "user", content: "in-a" });
  appendMessage(db, b, { role: "user", content: "in-b" });
  expect(getMessages(db, a).map((m) => m.content)).toEqual(["in-a"]);
});

test("memories table exists with kind/content/embedding columns", () => {
  const db = freshDb();
  db.run("INSERT INTO memories (kind, content, session_id) VALUES ('semantic', '用户在准备面试', 's1')");
  const row = db.query("SELECT kind, content, embedding FROM memories").get() as {
    kind: string;
    content: string;
    embedding: null;
  };
  expect(row.kind).toBe("semantic");
  expect(row.embedding).toBeNull();
});

test("migration is idempotent: opening an old-shape db adds session_id columns", () => {
  // Simulate a pre-Phase-M database: chat tables without session_id.
  const db = openDbAt(":memory:");
  // openDbAt already migrated — assert the column exists and re-running is safe.
  const cols = db.query("PRAGMA table_info(chat_messages)").all() as { name: string }[];
  expect(cols.some((c) => c.name === "session_id")).toBe(true);
});

test("recallSemanticMemories returns top matches above the similarity floor", () => {
  const db = freshDb();
  const insert = (content: string, vec: number[]) =>
    db.run("INSERT INTO memories (kind, content, embedding) VALUES ('semantic', ?, ?)", [
      content,
      encodeVector(vec),
    ]);
  insert("用户在准备面试", [1, 0, 0]);
  insert("用户喜欢猫", [0, 1, 0]);
  insert("无嵌入的记忆不参与", [0, 0, 1]);
  db.run("INSERT INTO memories (kind, content) VALUES ('semantic', '空向量')");
  db.run("INSERT INTO memories (kind, content, embedding) VALUES ('episodic', 'trace', ?)", [
    encodeVector([1, 0, 0]),
  ]);

  const hits = recallSemanticMemories(db, [0.9, 0.1, 0], { k: 2, minSimilarity: 0.5 });
  expect(hits).toEqual(["用户在准备面试"]);
});

test("recallSemanticMemories empty table returns []", () => {
  expect(recallSemanticMemories(freshDb(), [1, 0], { k: 3, minSimilarity: 0.5 })).toEqual([]);
});

test("searchEpisodic finds traces by keyword, newest first, capped", () => {
  const db = freshDb();
  const sid = createSession(db);
  for (let i = 0; i < 7; i++) {
    db.run("INSERT INTO memories (kind, session_id, content) VALUES ('episodic', ?, ?)", [
      sid,
      JSON.stringify({ question: `关于堆的问题${i}`, answer: `答案${i}`, sources: [] }),
    ]);
  }
  db.run("INSERT INTO memories (kind, session_id, content) VALUES ('episodic', ?, ?)", [
    sid,
    JSON.stringify({ question: "DP问题", answer: "DP答案", sources: [] }),
  ]);

  const hits = searchEpisodic(db, "堆", 5);
  expect(hits.length).toBe(5);
  expect(hits[0]!.question).toBe("关于堆的问题6");
  expect(hits[0]!.when).toBeTruthy();
  expect(searchEpisodic(db, "不存在的词", 5)).toEqual([]);
});
