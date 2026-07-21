// Summary endpoints: GET /summary/file, POST /summary/cached, POST /summary/generate,
// POST /summary/batch. Ports backend/app/routers/summary.py.
import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { SafePathError } from "./knowledge.ts";
import { getCachedSummary, getOrGenerate, type SummaryGenerator } from "./summary.ts";

export interface SummaryRoutesDeps {
  db: Database;
  knowledgeDir: string;
  generate: SummaryGenerator;
}

export function summaryRoutes(deps: SummaryRoutesDeps): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof SafePathError) return c.json({ detail: err.message }, 400);
    throw err;
  });

  app.get("/summary/file", (c) => {
    const filePath = c.req.query("file_path") ?? "";
    const summary = getCachedSummary(deps.db, filePath);
    if (summary === null) return c.json({ detail: `No cached summary for '${filePath}'` }, 404);
    return c.json({ file_path: filePath, summary, cached: true });
  });

  app.post("/summary/cached", async (c) => {
    const { file_paths } = (await c.req.json()) as { file_paths: string[] };
    const results = [];
    for (const fp of file_paths) {
      const summary = getCachedSummary(deps.db, fp);
      if (summary !== null) results.push({ file_path: fp, summary });
    }
    return c.json(results);
  });

  app.post("/summary/generate", async (c) => {
    const { file_path } = (await c.req.json()) as { file_path: string };
    const summary = await getOrGenerate(deps.db, file_path, deps.knowledgeDir, deps.generate);
    if (summary === null) return c.json({ detail: `File not found: '${file_path}'` }, 404);
    return c.json({ file_path, summary });
  });

  app.post("/summary/batch", async (c) => {
    const { file_paths } = (await c.req.json()) as { file_paths: string[] };
    const results = [];
    for (const fp of file_paths) {
      const summary = await getOrGenerate(deps.db, fp, deps.knowledgeDir, deps.generate);
      if (summary !== null) results.push({ file_path: fp, summary });
    }
    return c.json(results);
  });

  return app;
}
