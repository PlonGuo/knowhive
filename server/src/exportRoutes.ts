// Export endpoints: POST /export/full, POST /export/chat, POST /export/file.
// Ports backend/app/routers/export.py.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { basename } from "node:path";
import { exportChatHistory, exportFull } from "./export.ts";
import { resolveSafePath, SafePathError } from "./knowledge.ts";

export interface ExportRoutesDeps {
  db: Database;
  knowledgeDir: string;
  configPath: string;
}

export function exportRoutes(deps: ExportRoutesDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof SafePathError) return c.json({ detail: err.message }, 400);
    throw err;
  });

  app.post("/export/full", (c) => {
    const zip = exportFull(deps);
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);
    return c.body(zip.buffer as ArrayBuffer, 200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="knowhive-export-${stamp}.zip"`,
    });
  });

  app.post("/export/chat", (c) => c.json(exportChatHistory(deps.db)));

  app.post("/export/file", async (c) => {
    const { path } = (await c.req.json()) as { path: string };
    const resolved = resolveSafePath(deps.knowledgeDir, path);
    const file = Bun.file(resolved);
    if (!(await file.exists())) return c.json({ detail: "File not found" }, 404);
    return c.body(await file.arrayBuffer(), 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${basename(resolved)}"`,
    });
  });

  return app;
}
