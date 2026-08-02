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

const MASK_CHAR = "•";
const MASK_LEN = 8;
const KEY_TAIL = 4;

/**
 * Hide a provider key for GET /config. The last four characters survive so the
 * user can still tell which key is configured, which is the only thing the
 * Settings page needs it for.
 */
export function maskApiKey(key: string | null): string | null {
  if (key === null || key === "") return key;
  const mask = MASK_CHAR.repeat(MASK_LEN);
  return key.length <= KEY_TAIL ? MASK_CHAR.repeat(KEY_TAIL) : `${mask}${key.slice(-KEY_TAIL)}`;
}

/**
 * Inverse of maskApiKey for PUT /config. The Settings page round-trips the whole
 * config object, so an untouched key comes back as its own mask — writing that
 * through would destroy the real key. Anything else is taken at face value, so
 * setting a new key and clearing the key both still work.
 */
export function unmaskApiKey(incoming: string | null, stored: string | null): string | null {
  if (stored === null || stored === "") return incoming;
  return incoming === maskApiKey(stored) ? stored : incoming;
}
