import { expect, test } from "bun:test";
import { openDbAt } from "./db.ts";
import { memoryRoutes } from "./memoryRoutes.ts";
import { decodeVector, encodeVector } from "./retrieval.ts";

function makeApp() {
  const db = openDbAt(":memory:");
  db.run("INSERT INTO memories (kind, content, embedding) VALUES ('semantic', '用户用Python刷题', ?)", [
    encodeVector([1, 0]),
  ]);
  db.run("INSERT INTO memories (kind, content) VALUES ('procedural', '回答用中文')");
  db.run("INSERT INTO memories (kind, content) VALUES ('episodic', '{\"question\":\"q\"}')");
  const app = memoryRoutes({ db, embedFacts: async () => [[0, 1]] });
  return { db, app };
}

test("GET /memories lists non-episodic by default, filters by kind", async () => {
  const { app } = makeApp();
  const all = (await (await app.request("/memories")).json()) as { memories: { kind: string }[] };
  expect(all.memories.map((m) => m.kind).sort()).toEqual(["procedural", "semantic"]);

  const sem = (await (await app.request("/memories?kind=semantic")).json()) as {
    memories: { content: string }[];
  };
  expect(sem.memories.map((m) => m.content)).toEqual(["用户用Python刷题"]);
});

test("DELETE /memories/:id removes the row", async () => {
  const { db, app } = makeApp();
  const { memories } = (await (await app.request("/memories?kind=procedural")).json()) as {
    memories: { id: number }[];
  };
  await app.request(`/memories/${memories[0]!.id}`, { method: "DELETE" });
  const n = db.query("SELECT COUNT(*) AS n FROM memories WHERE kind='procedural'").get() as { n: number };
  expect(n.n).toBe(0);
});

test("PUT /memories/:id edits content and re-embeds semantic rows", async () => {
  const { db, app } = makeApp();
  const { memories } = (await (await app.request("/memories?kind=semantic")).json()) as {
    memories: { id: number }[];
  };
  const res = await app.request(`/memories/${memories[0]!.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "用户改用Rust刷题" }),
  });
  expect(res.status).toBe(200);
  const row = db.query("SELECT content, embedding FROM memories WHERE id = ?").get(memories[0]!.id) as {
    content: string;
    embedding: Uint8Array;
  };
  expect(row.content).toBe("用户改用Rust刷题");
  expect(Array.from(decodeVector(row.embedding))).toEqual([0, 1]);
});

test("PUT with empty content is rejected", async () => {
  const { app } = makeApp();
  const res = await app.request("/memories/1", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "  " }),
  });
  expect(res.status).toBe(400);
});
