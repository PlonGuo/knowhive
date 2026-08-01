// knowhive-pdf plugin client: spawn `knowhive-pdf --stdio`, validate the ready
// handshake, feed paths, collect one result/error per line. The plugin is an
// optional external tool (installed via `uv tool install knowhive-pdf`) — when
// it's absent the app simply has no PDF support; nothing else changes.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { DocumentIR } from "./documentIr.ts";

/** The IR schema this host understands (mirrors knowhive_pdf.SCHEMA_VERSION). */
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface PdfParseOk {
  path: string;
  ir: DocumentIR;
}

export interface PdfParseError {
  path: string;
  code: "needs_ocr" | "bad_text_layer" | "parse_failed";
  message: string;
}

export type PdfParseOutcome = PdfParseOk | PdfParseError;

export interface PdfPluginInfo {
  installed: boolean;
  bin?: string;
  plugin_version?: string;
  schema_version?: number;
  docling_version?: string;
}

interface ReadyLine {
  type: "ready";
  schema_version: number;
  plugin_version: string;
  docling_version: string;
}

/** Where `uv tool install` puts entry points, plus PATH fallback. */
export function findPluginBin(): string | null {
  const override = process.env.KNOWHIVE_PDF_BIN;
  if (override) return existsSync(override) ? override : null;
  const uvBin = join(homedir(), ".local", "bin", "knowhive-pdf");
  if (existsSync(uvBin)) return uvBin;
  const onPath = Bun.which("knowhive-pdf");
  return onPath ?? null;
}

/** Spawn the plugin and stream stdout lines as parsed JSON objects. */
async function* pluginLines(proc: Bun.Subprocess<"pipe", "pipe", "ignore">): AsyncGenerator<Record<string, unknown>> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield JSON.parse(line) as Record<string, unknown>;
    }
  }
}

function spawnPlugin(bin: string): Bun.Subprocess<"pipe", "pipe", "ignore"> {
  return Bun.spawn([bin, "--stdio"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
}

/** Handshake-only probe: is the plugin installed and speaking our schema? */
export async function pluginInfo(bin: string | null = findPluginBin()): Promise<PdfPluginInfo> {
  if (!bin || !existsSync(bin)) return { installed: false };
  try {
    const proc = spawnPlugin(bin);
    try {
      const first = await nextLine(proc);
      if (first?.type !== "ready") return { installed: false };
      const ready = first as unknown as ReadyLine;
      return {
        installed: true,
        bin,
        plugin_version: ready.plugin_version,
        schema_version: ready.schema_version,
        docling_version: ready.docling_version,
      };
    } finally {
      proc.stdin.end();
      proc.kill();
    }
  } catch {
    return { installed: false };
  }
}

async function nextLine(proc: Bun.Subprocess<"pipe", "pipe", "ignore">): Promise<Record<string, unknown> | null> {
  for await (const line of pluginLines(proc)) return line;
  return null;
}

/**
 * Parse a batch of PDFs through one plugin process (model load costs seconds —
 * pay it once per batch, not per file). Throws on plugin-level failures (missing
 * binary, wrong schema); per-file problems come back as coded outcomes.
 */
export async function parsePdfs(
  paths: string[],
  opts: { bin?: string | null } = {},
): Promise<PdfParseOutcome[]> {
  const bin = opts.bin ?? findPluginBin();
  if (!bin || !existsSync(bin)) {
    throw new Error("knowhive-pdf plugin is not installed (enable PDF support in Settings)");
  }

  const proc = spawnPlugin(bin);
  const outcomes: PdfParseOutcome[] = [];
  try {
    proc.stdin.write(paths.map((p) => p + "\n").join(""));
    proc.stdin.end();

    let sawReady = false;
    for await (const line of pluginLines(proc)) {
      if (!sawReady) {
        if (line.type !== "ready") throw new Error("knowhive-pdf: protocol error (no ready handshake)");
        const ready = line as unknown as ReadyLine;
        if (ready.schema_version !== SUPPORTED_SCHEMA_VERSION) {
          throw new Error(
            `knowhive-pdf schema_version ${ready.schema_version} is not supported (host expects ${SUPPORTED_SCHEMA_VERSION}) — update the plugin or the app`,
          );
        }
        sawReady = true;
        continue;
      }
      if (line.type === "result") {
        outcomes.push({ path: line.path as string, ir: line.ir as DocumentIR });
      } else if (line.type === "error") {
        outcomes.push({
          path: line.path as string,
          code: line.code as PdfParseError["code"],
          message: (line.message as string) ?? "",
        });
      }
      if (outcomes.length === paths.length) break;
    }
    if (!sawReady) throw new Error("knowhive-pdf: plugin produced no output");
    return outcomes;
  } finally {
    proc.kill();
  }
}

export function isParseError(o: PdfParseOutcome): o is PdfParseError {
  return "code" in o;
}

/**
 * Long-lived plugin process for one-file-at-a-time ingestion. Docling's model
 * load costs seconds; a batch import pays it once here instead of per file.
 * Calls are serialized internally — the protocol answers strictly in order.
 */
export class PdfPluginSession {
  private proc: Bun.Subprocess<"pipe", "pipe", "ignore"> | null = null;
  private lines: AsyncGenerator<Record<string, unknown>> | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private bin: string | null = findPluginBin()) {}

  private async ensureStarted(): Promise<void> {
    if (this.proc) return;
    if (!this.bin || !existsSync(this.bin)) {
      throw new Error("knowhive-pdf plugin is not installed (enable PDF support in Settings)");
    }
    this.proc = spawnPlugin(this.bin);
    this.lines = pluginLines(this.proc);
    const first = (await this.lines.next()).value as ReadyLine | undefined;
    if (!first || first.type !== "ready") {
      this.close();
      throw new Error("knowhive-pdf: protocol error (no ready handshake)");
    }
    if (first.schema_version !== SUPPORTED_SCHEMA_VERSION) {
      this.close();
      throw new Error(
        `knowhive-pdf schema_version ${first.schema_version} is not supported (host expects ${SUPPORTED_SCHEMA_VERSION})`,
      );
    }
  }

  /** Parse one file; concurrent callers are queued in request order. */
  parseOne(path: string): Promise<PdfParseOutcome> {
    const run = this.chain.then(async () => {
      await this.ensureStarted();
      this.proc!.stdin.write(path + "\n");
      this.proc!.stdin.flush();
      const line = (await this.lines!.next()).value as Record<string, unknown> | undefined;
      if (!line) throw new Error("knowhive-pdf: plugin exited mid-parse");
      if (line.type === "result") return { path: line.path as string, ir: line.ir as DocumentIR };
      return {
        path: line.path as string,
        code: line.code as PdfParseError["code"],
        message: (line.message as string) ?? "",
      };
    });
    // Keep the chain alive after failures so later calls still run.
    this.chain = run.catch(() => {});
    return run;
  }

  close(): void {
    try {
      this.proc?.stdin.end();
      this.proc?.kill();
    } catch {
      /* already gone */
    }
    this.proc = null;
    this.lines = null;
  }
}
