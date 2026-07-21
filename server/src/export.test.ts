import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { openDbAt } from "./db.ts";
import { exportChatHistory, exportFull } from "./export.ts";

// Parity tests against backend/app/services/export_service.py.

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), "knowhive-export-"));
  const knowledgeDir = join(dataDir, "knowledge");
  mkdirSync(join(knowledgeDir, "sub"), { recursive: true });
  writeFileSync(join(knowledgeDir, "a.md"), "# A");
  writeFileSync(join(knowledgeDir, "sub", "b.md"), "# B");
  const configPath = join(dataDir, "config.yaml");
  writeFileSync(configPath, "model_name: llama3.2\n");
  const db = openDbAt(":memory:");
  return { dataDir, knowledgeDir, configPath, db };
}

test("exportChatHistory returns messages ordered by creation time", () => {
  const { db } = setup();
  db.run("INSERT INTO chat_messages (role, content, created_at) VALUES ('user', 'hi', '2026-07-01')");
  db.run("INSERT INTO chat_messages (role, content, created_at) VALUES ('assistant', 'hey', '2026-07-02')");
  expect(exportChatHistory(db)).toEqual([
    { role: "user", content: "hi", created_at: "2026-07-01" },
    { role: "assistant", content: "hey", created_at: "2026-07-02" },
  ]);
});

test("exportFull zips knowledge files, config.yaml and chat_history.json", () => {
  const { db, knowledgeDir, configPath } = setup();
  db.run("INSERT INTO chat_messages (role, content, created_at) VALUES ('user', 'hi', '2026-07-01')");
  const zip = exportFull({ db, knowledgeDir, configPath });
  const entries = unzipSync(zip);
  expect(Object.keys(entries).sort()).toEqual([
    "chat_history.json",
    "config.yaml",
    "knowledge/a.md",
    "knowledge/sub/b.md",
  ]);
  expect(strFromU8(entries["knowledge/a.md"]!)).toBe("# A");
  expect(strFromU8(entries["config.yaml"]!)).toBe("model_name: llama3.2\n");
  expect(JSON.parse(strFromU8(entries["chat_history.json"]!))).toEqual([
    { role: "user", content: "hi", created_at: "2026-07-01" },
  ]);
});

test("exportFull tolerates a missing knowledge dir and config", () => {
  const { db } = setup();
  const zip = exportFull({ db, knowledgeDir: "/nonexistent/kb", configPath: "/nonexistent/config.yaml" });
  expect(Object.keys(unzipSync(zip))).toEqual(["chat_history.json"]);
});
