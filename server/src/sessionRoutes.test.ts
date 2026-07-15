import { expect, test } from "bun:test";
import { openDbAt } from "./db.ts";
import { sessionRoutes } from "./sessionRoutes.ts";
import { appendMessage } from "./sessions.ts";

function makeApp() {
  const db = openDbAt(":memory:");
  return { db, app: sessionRoutes({ db }) };
}

test("POST /sessions creates; GET /sessions lists", async () => {
  const { app } = makeApp();
  const created = await app.request("/sessions", { method: "POST" });
  const { id } = (await created.json()) as { id: string };
  expect(id.length).toBeGreaterThan(10);

  const list = await app.request("/sessions");
  const { sessions } = (await list.json()) as { sessions: { id: string }[] };
  expect(sessions.map((s) => s.id)).toEqual([id]);
});

test("GET /sessions/:id/messages returns persisted messages", async () => {
  const { db, app } = makeApp();
  const created = await app.request("/sessions", { method: "POST" });
  const { id } = (await created.json()) as { id: string };
  appendMessage(db, id, { role: "user", content: "hello" });

  const res = await app.request(`/sessions/${id}/messages`);
  const { messages } = (await res.json()) as { messages: { content: string }[] };
  expect(messages.map((m) => m.content)).toEqual(["hello"]);
});

test("DELETE /sessions/:id removes the session", async () => {
  const { app } = makeApp();
  const created = await app.request("/sessions", { method: "POST" });
  const { id } = (await created.json()) as { id: string };
  await app.request(`/sessions/${id}`, { method: "DELETE" });
  const list = await app.request("/sessions");
  expect(((await list.json()) as { sessions: unknown[] }).sessions).toEqual([]);
});
