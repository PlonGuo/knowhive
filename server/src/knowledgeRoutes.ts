// Knowledge endpoints: GET /knowledge/tree, GET/PUT/DELETE /knowledge/file,
// PUT /knowledge/file/content. Ports backend/app/routers/knowledge.py.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname } from "node:path";
import { buildTree, resolveSafePath, SafePathError } from "./knowledge.ts";
import { deleteChunksForFile, renameChunksFilePath } from "./store.ts";

export interface KnowledgeRoutesDeps {
  knowledgeDir: string;
  db: Database;
  /** Re-index a file after its content changed (wired to ingestText + live embedder). */
  reingest: (absPath: string, content: string) => Promise<void>;
}

export function knowledgeRoutes(deps: KnowledgeRoutesDeps): Hono {
  const app = new Hono();

  // Map SafePathError → 400 with FastAPI-style {detail} body.
  app.onError((err, c) => {
    if (err instanceof SafePathError) return c.json({ detail: err.message }, 400);
    throw err;
  });

  app.get("/knowledge/tree", (c) => {
    mkdirSync(deps.knowledgeDir, { recursive: true });
    return c.json(buildTree(deps.knowledgeDir));
  });

  app.get("/knowledge/file", (c) => {
    const path = c.req.query("path") ?? "";
    const resolved = resolveSafePath(deps.knowledgeDir, path);
    if (!isFile(resolved)) return c.json({ detail: "File not found" }, 404);
    return c.json({ name: basename(resolved), path, content: readFileSync(resolved, "utf8") });
  });

  app.put("/knowledge/file/content", async (c) => {
    const { path, content } = (await c.req.json()) as { path: string; content: string };
    const resolved = resolveSafePath(deps.knowledgeDir, path);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      return c.json({ detail: "Cannot save content to directories" }, 400);
    }
    if (!isFile(resolved)) return c.json({ detail: "File not found" }, 404);

    writeFileSync(resolved, content);
    await deps.reingest(resolved, content);
    return c.json({ path, status: "saved" });
  });

  app.put("/knowledge/file", async (c) => {
    const { old_path, new_path } = (await c.req.json()) as { old_path: string; new_path: string };
    const oldResolved = resolveSafePath(deps.knowledgeDir, old_path);
    const newResolved = resolveSafePath(deps.knowledgeDir, new_path);

    if (existsSync(oldResolved) && statSync(oldResolved).isDirectory()) {
      return c.json({ detail: "Cannot rename directories" }, 400);
    }
    if (!isFile(oldResolved)) return c.json({ detail: "Source file not found" }, 404);
    if (existsSync(newResolved)) return c.json({ detail: "Target file already exists" }, 409);

    mkdirSync(dirname(newResolved), { recursive: true });
    renameSync(oldResolved, newResolved);
    renameChunksFilePath(deps.db, oldResolved, newResolved);
    deps.db.run(
      `UPDATE documents SET file_path = ?, file_name = ?, updated_at = datetime('now')
       WHERE file_path = ?`,
      [newResolved, basename(newResolved), oldResolved],
    );
    return c.json({ old_path, new_path, status: "renamed" });
  });

  app.delete("/knowledge/file", (c) => {
    const path = c.req.query("path") ?? "";
    const resolved = resolveSafePath(deps.knowledgeDir, path);
    if (existsSync(resolved) && statSync(resolved).isDirectory()) {
      return c.json({ detail: "Cannot delete directories" }, 400);
    }
    if (!isFile(resolved)) return c.json({ detail: "File not found" }, 404);

    deleteChunksForFile(deps.db, resolved);
    deps.db.run("DELETE FROM documents WHERE file_path = ?", [resolved]);
    unlinkSync(resolved);
    return c.json({ path, status: "deleted" });
  });

  return app;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}
