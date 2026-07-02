import { test, expect } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { openDbAt } from "./db.ts";
import { ingestText } from "./ingest.ts";
import { knowledgeRoutes } from "./knowledgeRoutes.ts";

// Parity tests against backend/app/routers/knowledge.py endpoints.

const fakeEmbed = (texts: string[]): Promise<number[][]> =>
  Promise.resolve(texts.map(() => [1, 0, 0]));

const DOC =
  "# Sorting\nSorting algorithms arrange elements of a list into an order such as ascending or descending for easier processing.\n";

function setup() {
  const knowledgeDir = mkdtempSync(join(tmpdir(), "knowhive-kroutes-"));
  const db = openDbAt(":memory:");
  const reingested: string[] = [];
  const app = new Hono().route(
    "/",
    knowledgeRoutes({
      knowledgeDir,
      db,
      reingest: async (absPath, content) => {
        reingested.push(absPath);
        await ingestText(db, absPath, content, fakeEmbed);
      },
    }),
  );
  return { app, knowledgeDir, db, reingested };
}

async function seedFile(db: Database, knowledgeDir: string, rel: string, text = DOC) {
  const abs = join(knowledgeDir, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, text);
  await ingestText(db, abs, text, fakeEmbed);
  return abs;
}

test("GET /knowledge/tree creates a missing knowledge dir and returns the root node", async () => {
  const { app, knowledgeDir } = setup();
  const res = await app.request(`/knowledge/tree`);
  expect(res.status).toBe(200);
  const tree = await res.json();
  expect(tree.type).toBe("directory");
  expect(tree.path).toBe("");
  expect(existsSync(knowledgeDir)).toBe(true);
});

test("GET /knowledge/file returns file content", async () => {
  const { app, db, knowledgeDir } = setup();
  await seedFile(db, knowledgeDir, "note.md");
  const res = await app.request(`/knowledge/file?path=note.md`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ name: "note.md", path: "note.md", content: DOC });
});

test("GET /knowledge/file 404s on a missing file and 400s on traversal", async () => {
  const { app } = setup();
  expect((await app.request(`/knowledge/file?path=nope.md`)).status).toBe(404);
  expect((await app.request(`/knowledge/file?path=../etc/passwd`)).status).toBe(400);
});

test("PUT /knowledge/file/content writes to disk and re-ingests", async () => {
  const { app, db, knowledgeDir, reingested } = setup();
  const abs = await seedFile(db, knowledgeDir, "note.md");
  const res = await app.request(`/knowledge/file/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "note.md", content: "# Updated\nNew body content for this note.\n" }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ path: "note.md", status: "saved" });
  expect(readFileSync(abs, "utf8")).toContain("# Updated");
  expect(reingested).toEqual([abs]);
});

test("PUT /knowledge/file/content 404s when the file does not exist", async () => {
  const { app } = setup();
  const res = await app.request(`/knowledge/file/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "missing.md", content: "x" }),
  });
  expect(res.status).toBe(404);
});

test("PUT /knowledge/file renames on disk and updates documents + chunks rows", async () => {
  const { app, db, knowledgeDir } = setup();
  const oldAbs = await seedFile(db, knowledgeDir, "old.md");
  const res = await app.request(`/knowledge/file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: "old.md", new_path: "dir/new.md" }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ old_path: "old.md", new_path: "dir/new.md", status: "renamed" });
  const newAbs = join(knowledgeDir, "dir", "new.md");
  expect(existsSync(oldAbs)).toBe(false);
  expect(existsSync(newAbs)).toBe(true);
  const doc = db.query("SELECT file_path, file_name FROM documents").get() as {
    file_path: string;
    file_name: string;
  };
  expect(doc).toEqual({ file_path: newAbs, file_name: "new.md" });
  const chunk = db.query("SELECT DISTINCT file_path FROM chunks").all();
  expect(chunk).toEqual([{ file_path: newAbs }]);
});

test("PUT /knowledge/file 409s when the target exists and 404s when the source is missing", async () => {
  const { app, db, knowledgeDir } = setup();
  await seedFile(db, knowledgeDir, "a.md");
  await seedFile(db, knowledgeDir, "b.md");
  const put = (body: unknown) =>
    app.request(`/knowledge/file`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  expect((await put({ old_path: "a.md", new_path: "b.md" })).status).toBe(409);
  expect((await put({ old_path: "ghost.md", new_path: "c.md" })).status).toBe(404);
});

test("DELETE /knowledge/file removes disk file, chunks and documents row", async () => {
  const { app, db, knowledgeDir } = setup();
  const abs = await seedFile(db, knowledgeDir, "gone.md");
  const res = await app.request(`/knowledge/file?path=gone.md`, { method: "DELETE" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ path: "gone.md", status: "deleted" });
  expect(existsSync(abs)).toBe(false);
  expect((db.query("SELECT COUNT(*) AS c FROM documents").get() as { c: number }).c).toBe(0);
  expect((db.query("SELECT COUNT(*) AS c FROM chunks").get() as { c: number }).c).toBe(0);
});

test("DELETE /knowledge/file 404s on a missing file", async () => {
  const { app } = setup();
  expect((await app.request(`/knowledge/file?path=nope.md`, { method: "DELETE" })).status).toBe(404);
});
