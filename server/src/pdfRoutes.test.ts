import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { Hono } from "hono";
import { pdfRoutes } from "./pdfRoutes.ts";

const FAKE = join(import.meta.dir, "..", "test-fixtures", "fake-knowhive-pdf.sh");

describe("GET /pdf/status", () => {
  test("reports plugin handshake info when installed", async () => {
    const app = new Hono().route("/", pdfRoutes({ bin: () => FAKE }));
    const res = await app.request("/pdf/status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installed).toBe(true);
    expect(body.plugin_version).toBe("9.9.9-fake");
    expect(body.schema_version).toBe(1);
  });

  test("reports installed:false when the plugin is missing", async () => {
    const app = new Hono().route("/", pdfRoutes({ bin: () => null }));
    const body = await (await app.request("/pdf/status")).json();
    expect(body.installed).toBe(false);
  });
});

describe("POST /pdf/install", () => {
  test("runs the install steps and lands on complete", async () => {
    const steps: string[] = [];
    const app = new Hono().route(
      "/",
      pdfRoutes({
        bin: () => FAKE,
        installSteps: {
          install: async () => {
            steps.push("install");
          },
          prefetch: async () => {
            steps.push("prefetch");
          },
        },
      }),
    );
    const res = await app.request("/pdf/install", { method: "POST" });
    expect(res.status).toBe(200);
    // Poll until the background flow finishes.
    for (let i = 0; i < 50; i++) {
      const s = await (await app.request("/pdf/install-status")).json();
      if (s.status === "complete" || s.status === "error") break;
      await Bun.sleep(10);
    }
    const final = await (await app.request("/pdf/install-status")).json();
    expect(final.status).toBe("complete");
    expect(steps).toEqual(["install", "prefetch"]);
  });

  test("surfaces install failures as status error", async () => {
    const app = new Hono().route(
      "/",
      pdfRoutes({
        bin: () => null,
        installSteps: {
          install: async () => {
            throw new Error("uv not found");
          },
          prefetch: async () => {},
        },
      }),
    );
    await app.request("/pdf/install", { method: "POST" });
    for (let i = 0; i < 50; i++) {
      const s = await (await app.request("/pdf/install-status")).json();
      if (s.status === "error") break;
      await Bun.sleep(10);
    }
    const final = await (await app.request("/pdf/install-status")).json();
    expect(final.status).toBe("error");
    expect(final.error).toContain("uv not found");
  });

  test("second install while running returns 409", async () => {
    let release: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const app = new Hono().route(
      "/",
      pdfRoutes({
        bin: () => FAKE,
        installSteps: { install: () => gate, prefetch: async () => {} },
      }),
    );
    expect((await app.request("/pdf/install", { method: "POST" })).status).toBe(200);
    expect((await app.request("/pdf/install", { method: "POST" })).status).toBe(409);
    release!();
  });
});
