// Browser-origin guard for the loopback sidecar.
//
// Threat model: the server binds 127.0.0.1, so it is not reachable from the
// network. It IS reachable from any page the user's browser has open, and every
// route is unauthenticated. Two distinct attacks follow, and they need two
// different checks:
//
//   1. Cross-origin fetch. https://evil.example runs
//      `fetch('http://127.0.0.1:18200/config')`. The same-origin policy would
//      normally stop the page from READING the response — but the previous
//      `cors()` with no options answered `Access-Control-Allow-Origin: *`, which
//      explicitly hands the response over. Fix: an Origin allowlist.
//
//   2. DNS rebinding. The attacker points evil.example at 127.0.0.1 after the
//      page loads. The request is then same-origin, so the browser sends no
//      Origin header at all and CORS never applies. The only header that still
//      gives it away is Host, which stays evil.example. Fix: require a loopback
//      Host. This is why an Origin allowlist alone is not enough.
//
// Deliberately NOT a shared secret: any native process on this machine can read
// the config file directly, so a token would add ceremony without changing what
// a local attacker can reach. The browser is the whole threat here.
import type { MiddlewareHandler } from "hono";

/** Tauri v2 webview origins (macOS/Linux use the custom scheme, Windows the https one). */
export const ALLOWED_ORIGINS = [
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
];

/** Exact loopback only — "127.0.0.1.evil.example" must not pass a prefix test. */
function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
}

export function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    return isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return false; // unparseable → not allowed (fail closed)
  }
}

/** Strip the port from a Host header, handling the [::1]:port bracket form. */
function hostnameOfHostHeader(host: string): string | null {
  const h = host.trim().toLowerCase();
  if (!h) return null;
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? null : h.slice(1, end);
  }
  const colon = h.indexOf(":");
  return colon === -1 ? h : h.slice(0, colon);
}

export function localGuard(): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    // A missing Host is HTTP/1.1-illegal; treat it as loopback so non-browser
    // callers (the Rust health probe, curl --http1.0) are not broken.
    if (host !== undefined) {
      const hostname = hostnameOfHostHeader(host);
      if (!hostname || !isLoopbackHostname(hostname)) {
        return c.json({ detail: "Request rejected: non-loopback Host header" }, 403);
      }
    }
    // No Origin means no browser page is asking on its own behalf.
    const origin = c.req.header("origin");
    if (origin !== undefined && !isOriginAllowed(origin)) {
      return c.json({ detail: "Request rejected: origin not allowed" }, 403);
    }
    await next();
  };
}
