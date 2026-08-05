// Langfuse tracing — DEV ONLY, and structurally so.
//
// Why this exists: every insight in this project comes from offline evals, so there is
// no path from a real failure back into the eval set. A trace tree is that path.
//
// Why Langfuse and not a self-built store: the expensive part of self-building is the
// viewer, which is exactly what Langfuse gives away. The usual argument against it —
// "a local-first app must not ship prompts off the machine" — only applies to the
// PACKAGED app, and this never reaches it (see build-dist.ts DEV_ONLY_EXTERNALS).
//
// Two guarantees, in order of importance:
//   1. No keys -> not merely disabled, never even imported. The Langfuse packages are
//      loaded through dynamic import inside the gated branch, so a build without keys
//      pays nothing and cannot fail on a missing module.
//   2. Tracing can never break a request. Init failures disable tracing and log; the
//      per-span wrapper falls through to calling the function directly.
//
// The AI SDK half needs no manual spans: ai@7 broadcasts lifecycle events on its own
// telemetry channel and LangfuseVercelAiSdkIntegration subscribes to them. That covers
// streamText/generateText/tool calls but NOT the retrieval chain, which never touches
// the SDK — hence `traced()` and the spans in index.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Langfuse observation types we use. Picking the right one is not cosmetic: the UI
 * renders retriever/embedding/guardrail differently from a generic span. */
export type SpanKind = "span" | "chain" | "retriever" | "embedding" | "guardrail";

/** What a span body can record. Kept structural so callers never import Langfuse types. */
export interface SpanRecorder {
  set(attributes: { input?: unknown; output?: unknown; metadata?: Record<string, unknown> }): void;
}

const NOOP_RECORDER: SpanRecorder = { set() {} };

// Bound after a successful init; null means "tracing off", which is the default and the
// only state the packaged app can ever be in.
let startActive:
  | ((name: string, fn: (span: { update: (a: unknown) => void }) => unknown, opts?: unknown) => unknown)
  | null = null;
let propagate: ((attrs: unknown, fn: () => unknown) => unknown) | null = null;
let sdk: { shutdown: () => Promise<void> } | null = null;

/**
 * Pull LANGFUSE_* out of a .env the runtime did not pick up on its own.
 *
 * bun auto-loads .env from the process cwd, and the Tauri shell spawns the sidecar with
 * cwd=server/ — so the repo-root .env where the keys actually live is invisible. Only
 * LANGFUSE_-prefixed keys are read: an observability module has no business quietly
 * importing OPENAI_API_KEY into the process.
 */
function loadLangfuseEnv(): void {
  const candidates = [join(import.meta.dir, "..", "..", ".env"), join(import.meta.dir, "..", ".env")];
  for (const file of candidates) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // absent is the normal case
    }
    for (const line of text.split("\n")) {
      const match = /^\s*(LANGFUSE_[A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key!] !== undefined) continue; // a real env var always wins
      let value = rawValue!.trim();
      if (/^(".*"|'.*')$/s.test(value)) value = value.slice(1, -1);
      process.env[key!] = value;
    }
  }
}

/** True once keys are resolvable. Exported for the startup log and tests. */
export function tracingConfigured(): boolean {
  return Boolean(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
}

/** True only after a successful init — i.e. spans will actually be recorded. */
export function tracingActive(): boolean {
  return startActive !== null;
}

/**
 * Start tracing if keys are present. Safe to call unconditionally; safe to await.
 * Never throws.
 */
export async function initTracing(): Promise<void> {
  loadLangfuseEnv();
  if (!tracingConfigured()) return;
  try {
    const [otelSdk, langfuseOtel, langfuseVercel, langfuseTracing, aiSdk] = await Promise.all([
      import("@opentelemetry/sdk-node"),
      import("@langfuse/otel"),
      import("@langfuse/vercel-ai-sdk"),
      import("@langfuse/tracing"),
      import("ai"),
    ]);
    const started = new otelSdk.NodeSDK({ spanProcessors: [new langfuseOtel.LangfuseSpanProcessor()] });
    started.start();
    // One registration wires every ai@7 call in the process — no per-call opt-in, no
    // module patching (which is what would have broken under `bun build`).
    aiSdk.registerTelemetry(new langfuseVercel.LangfuseVercelAiSdkIntegration());
    sdk = started;
    startActive = langfuseTracing.startActiveObservation as typeof startActive;
    propagate = langfuseTracing.propagateAttributes as typeof propagate;
    console.log(`[tracing] Langfuse on → ${process.env.LANGFUSE_BASE_URL ?? "https://cloud.langfuse.com"}`);
  } catch (err) {
    startActive = null;
    propagate = null;
    sdk = null;
    console.error("[tracing] init failed, continuing without tracing:", err);
  }
}

/** Flush pending spans. The exporter batches, so without this a short-lived process
 * (evals, spikes) exits with its traces still in memory. */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  try {
    await sdk.shutdown();
  } catch (err) {
    console.error("[tracing] shutdown failed:", err);
  } finally {
    sdk = null;
    startActive = null;
    propagate = null;
  }
}

/**
 * Run `fn` inside a span. When tracing is off this is `fn(noop)` — same call, same
 * value, no allocation beyond the shared no-op recorder.
 *
 * Nesting is implicit: spans opened inside `fn` become children, which is what turns
 * the retrieval chain into a tree instead of five siblings.
 */
export function traced<T>(name: string, kind: SpanKind, fn: (rec: SpanRecorder) => T): T {
  const start = startActive;
  if (!start) return fn(NOOP_RECORDER);
  try {
    return start(name, (span) => fn({ set: (attributes) => span.update(attributes) }), {
      asType: kind,
    }) as T;
  } catch (err) {
    console.error(`[tracing] span "${name}" failed to start, running untraced:`, err);
    return fn(NOOP_RECORDER);
  }
}

/** A span the caller closes itself. `end` is idempotent and safe when tracing is off. */
export interface OpenSpan extends SpanRecorder {
  end(): void;
}

const NOOP_OPEN_SPAN: OpenSpan = { set() {}, end() {} };

/**
 * Like {@link traced}, but the span stays open after `fn` returns — the caller must
 * `end()` it.
 *
 * Needed for streaming: a chat handler returns its Response while the model is still
 * producing tokens, so a span that closed on return would report the time to *start*
 * streaming and read as the whole request. Measured before this existed: root 0.9s
 * against a 5.7s child, i.e. the parent claimed to be 6x faster than its own contents.
 *
 * Children are still parented correctly — the span is active for the duration of `fn`,
 * which is when the retrieval spans and the AI SDK's own span get created.
 */
export function tracedOpen<T>(name: string, kind: SpanKind, fn: (span: OpenSpan) => T): T {
  const start = startActive;
  if (!start) return fn(NOOP_OPEN_SPAN);
  try {
    return start(
      name,
      (span) => {
        let ended = false;
        return fn({
          set: (attributes) => span.update(attributes),
          // Idempotent: the finish and error paths can both fire, and double-ending a
          // span is an OTel-level error.
          end: () => {
            if (ended) return;
            ended = true;
            try {
              (span as unknown as { end: () => void }).end();
            } catch (err) {
              console.error(`[tracing] span "${name}" failed to end:`, err);
            }
          },
        });
      },
      { asType: kind, endOnExit: false },
    ) as T;
  } catch (err) {
    console.error(`[tracing] span "${name}" failed to start, running untraced:`, err);
    return fn(NOOP_OPEN_SPAN);
  }
}

/**
 * Attach trace-level attributes (sessionId, tags…) to everything started inside `fn`.
 * Grouping by sessionId is what makes a multi-turn conversation readable in the UI.
 */
export function withTraceAttributes<T>(attributes: Record<string, unknown>, fn: () => T): T {
  const wrap = propagate;
  if (!wrap) return fn();
  try {
    return wrap(attributes, fn) as T;
  } catch (err) {
    console.error("[tracing] attribute propagation failed, running untraced:", err);
    return fn();
  }
}
