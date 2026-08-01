// PDF plugin management endpoints.
//
//   GET  /pdf/status          → plugin handshake info (installed? versions?)
//   POST /pdf/install         → uv tool install + model prefetch, in background
//   GET  /pdf/install-status  → idle | installing | prefetching | complete | error
//
// Install delegates the heavy lifting to uv (Python runtime + PyPI deps) and to
// the plugin itself (--prefetch-models pulls docling's layout models so the
// user's FIRST parse doesn't stall on a multi-hundred-MB download).
import { Hono } from "hono";
import { findPluginBin, pluginInfo } from "./pdfPlugin.ts";

export interface PdfInstallSteps {
  /** `uv tool install knowhive-pdf` by default. */
  install: () => Promise<void>;
  /** `knowhive-pdf --prefetch-models` by default. */
  prefetch: () => Promise<void>;
}

export interface PdfRoutesDeps {
  bin?: () => string | null;
  installSteps?: PdfInstallSteps;
}

type InstallState =
  | { status: "idle" }
  | { status: "installing" }
  | { status: "prefetching" }
  | { status: "complete" }
  | { status: "error"; error: string };

async function runStep(cmd: string[]): Promise<void> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(proc.stderr as ReadableStream).text();
  if ((await proc.exited) !== 0) {
    throw new Error(`${cmd.join(" ")} failed: ${stderr.slice(-400)}`);
  }
}

function defaultSteps(bin: () => string | null): PdfInstallSteps {
  return {
    install: async () => {
      const uv = Bun.which("uv");
      if (!uv) throw new Error("uv not found — install uv first (https://docs.astral.sh/uv/)");
      await runStep([uv, "tool", "install", "--upgrade", "knowhive-pdf"]);
    },
    prefetch: async () => {
      const pluginBin = bin();
      if (!pluginBin) throw new Error("knowhive-pdf installed but not found on PATH");
      await runStep([pluginBin, "--prefetch-models"]);
    },
  };
}

export function pdfRoutes(deps: PdfRoutesDeps = {}): Hono {
  const app = new Hono();
  const bin = deps.bin ?? findPluginBin;
  const steps = deps.installSteps ?? defaultSteps(bin);

  let state: InstallState = { status: "idle" };

  app.get("/pdf/status", async (c) => c.json(await pluginInfo(bin())));

  app.get("/pdf/install-status", (c) => c.json(state));

  app.post("/pdf/install", (c) => {
    if (state.status === "installing" || state.status === "prefetching") {
      return c.json({ detail: "install already running" }, 409);
    }
    state = { status: "installing" };
    (async () => {
      await steps.install();
      state = { status: "prefetching" };
      await steps.prefetch();
      state = { status: "complete" };
    })().catch((err) => {
      state = { status: "error", error: (err as Error).message };
    });
    return c.json({ status: "accepted" });
  });

  return app;
}
