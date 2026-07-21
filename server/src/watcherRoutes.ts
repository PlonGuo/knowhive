// Watcher endpoints: GET /watcher/status, POST /watcher/toggle.
// Ports backend/app/routers/watcher.py.
import { Hono } from "hono";
import type { FileWatcher } from "./watcher.ts";

export interface WatcherRoutesDeps {
  watcher: FileWatcher;
}

export function watcherRoutes(deps: WatcherRoutesDeps): Hono {
  const app = new Hono();

  app.get("/watcher/status", (c) => c.json(deps.watcher.status()));

  app.post("/watcher/toggle", async (c) => {
    const { enabled } = (await c.req.json()) as { enabled: boolean };
    if (enabled) deps.watcher.start();
    else deps.watcher.stop();
    return c.json(deps.watcher.status());
  });

  return app;
}
