// Knowledge-base export: full ZIP (knowledge/ + config.yaml + chat_history.json) and
// chat history JSON. Ports backend/app/services/export_service.py using fflate.
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { strToU8, zipSync, type Zippable } from "fflate";

export interface ChatExportRow {
  role: string;
  content: string;
  created_at: string;
}

export interface ExportFullOptions {
  db: Database;
  knowledgeDir: string;
  configPath: string;
}

export function exportChatHistory(db: Database): ChatExportRow[] {
  return db
    .query("SELECT role, content, created_at FROM chat_messages ORDER BY created_at")
    .all() as ChatExportRow[];
}

/** Build an in-memory ZIP containing knowledge/, config.yaml, and chat_history.json. */
export function exportFull(opts: ExportFullOptions): Uint8Array {
  const entries: Zippable = {};

  if (existsSync(opts.knowledgeDir)) {
    const glob = new Bun.Glob("**/*");
    for (const rel of glob.scanSync({ cwd: opts.knowledgeDir })) {
      const abs = join(opts.knowledgeDir, rel);
      const arcname = "knowledge/" + relative(opts.knowledgeDir, abs).split(sep).join("/");
      entries[arcname] = readFileSync(abs);
    }
  }

  if (existsSync(opts.configPath)) {
    entries["config.yaml"] = readFileSync(opts.configPath);
  }

  entries["chat_history.json"] = strToU8(JSON.stringify(exportChatHistory(opts.db), null, 2));

  return zipSync(entries);
}
