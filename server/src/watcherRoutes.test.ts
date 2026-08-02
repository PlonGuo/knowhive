import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { FileWatcher } from "./watcher.ts";
import { watcherRoutes } from "./watcherRoutes.ts";

// Parity tests against backend/app/routers/watcher.py (GET /watcher/status, POST /watcher/toggle).

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowhive-wroutes-"));
  const watcher = new FileWatcher({ knowledgeDir: dir, onChange: async () => {} });
  const app = new Hono().route("/", watcherRoutes({ watcher }));
  return { app, dir, watcher };
}

test("GET /watcher/status returns the watcher status", async () => {
  const { app, dir } = setup();
  const res = await app.request("/watcher/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    running: false,
    knowledge_dir: dir,
    extensions: [".docx", ".md", ".txt"],
    syncing: false,
  });
});

test("POST /watcher/toggle starts and stops the watcher", async () => {
  const { app, watcher } = setup();
  const toggle = (enabled: boolean) =>
    app.request("/watcher/toggle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });

  const on = await toggle(true);
  expect(on.status).toBe(200);
  expect((await on.json()).running).toBe(true);
  expect(watcher.status().running).toBe(true);

  const off = await toggle(false);
  expect((await off.json()).running).toBe(false);
  expect(watcher.status().running).toBe(false);
});
