import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { ALLOWED_ORIGINS, isOriginAllowed, localGuard } from "./localGuard.ts";

// Threat model: the sidecar binds 127.0.0.1, so it is not reachable from the
// network — but it IS reachable from any page the user's browser has open.
// Wildcard CORS told the browser it was fine to hand those responses to any site,
// and there is no auth on any route.

describe("isOriginAllowed", () => {
  test("rejects a public web origin (the actual attack)", () => {
    expect(isOriginAllowed("https://evil.example")).toBe(false);
    expect(isOriginAllowed("http://evil.example:8080")).toBe(false);
  });

  test("allows the Tauri webview origins", () => {
    expect(isOriginAllowed("tauri://localhost")).toBe(true);
    expect(isOriginAllowed("http://tauri.localhost")).toBe(true);
    expect(isOriginAllowed("https://tauri.localhost")).toBe(true);
  });

  test("allows a loopback dev server on any port", () => {
    expect(isOriginAllowed("http://localhost:5173")).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:18200")).toBe(true);
    expect(isOriginAllowed("http://[::1]:5173")).toBe(true);
  });

  test("does not allow a hostname that merely ends in localhost", () => {
    expect(isOriginAllowed("http://notlocalhost")).toBe(false);
    expect(isOriginAllowed("https://evil-localhost.example")).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1.evil.example")).toBe(false);
  });

  test("rejects unparseable origins rather than letting them through", () => {
    expect(isOriginAllowed("not a url")).toBe(false);
    expect(isOriginAllowed("")).toBe(false);
  });

  test("exposes the literal Tauri origins for the CORS layer", () => {
    expect(ALLOWED_ORIGINS).toContain("tauri://localhost");
  });
});

describe("localGuard middleware", () => {
  const app = new Hono();
  app.use("*", localGuard());
  app.get("/secret", (c) => c.json({ notes: ["private"] }));

  const req = (headers: Record<string, string>) =>
    app.request("/secret", { headers });

  test("allows a request with no Origin (native client, health probe, curl)", async () => {
    expect((await req({ host: "127.0.0.1:18200" })).status).toBe(200);
  });

  test("allows the Tauri webview", async () => {
    const res = await req({ host: "127.0.0.1:18200", origin: "tauri://localhost" });
    expect(res.status).toBe(200);
  });

  test("blocks a cross-origin fetch from a malicious page", async () => {
    const res = await req({ host: "127.0.0.1:18200", origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain("private");
  });

  test("blocks DNS rebinding: same-origin request whose Host is not loopback", async () => {
    // After rebinding, the page's own origin resolves to 127.0.0.1, so the browser
    // sends no Origin header and CORS never applies — but Host is still the
    // attacker's domain. This is the only header that gives the attack away.
    const res = await req({ host: "evil.example" });
    expect(res.status).toBe(403);
  });

  test("accepts loopback Host in its usual spellings", async () => {
    for (const host of ["127.0.0.1:18200", "localhost:18200", "[::1]:18200", "127.0.0.1"]) {
      expect((await req({ host })).status).toBe(200);
    }
  });
});
