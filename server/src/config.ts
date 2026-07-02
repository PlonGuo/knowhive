// Config load/save. Ports backend/app/config.py — same on-disk format (config.yaml in
// the data dir) and the legacy `use_hyde` → `pre_retrieval_strategy` migration, so
// existing user configs keep working.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";

export function configPath(dataDir: string): string {
  return join(dataDir, "config.yaml");
}

export function loadConfig(dataDir: string): AppConfig {
  const path = configPath(dataDir);
  if (!existsSync(path)) return AppConfigSchema.parse({});

  const raw = (parse(readFileSync(path, "utf8")) ?? {}) as Record<string, unknown>;
  // Migrate legacy use_hyde → pre_retrieval_strategy (mirrors config.py).
  if ("use_hyde" in raw && !("pre_retrieval_strategy" in raw)) {
    raw.pre_retrieval_strategy = raw.use_hyde ? "hyde" : "none";
  }
  delete raw.use_hyde;
  return AppConfigSchema.parse(raw);
}

export function saveConfig(config: AppConfig, dataDir: string): void {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath(dataDir), stringify(config));
}
