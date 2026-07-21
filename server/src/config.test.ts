import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPath, loadConfig, saveConfig } from "./config.ts";
import { AppConfigSchema } from "../../shared/schema.ts";

// Parity tests against backend/app/config.py (load_config/save_config).

const tempDir = () => mkdtempSync(join(tmpdir(), "knowhive-config-"));

test("loadConfig returns defaults when config.yaml is missing", () => {
  const cfg = loadConfig(tempDir());
  expect(cfg).toEqual({
    llm_provider: "ollama",
    model_name: "llama3.2",
    base_url: "http://localhost:11434",
    api_key: null,
    embedding_language: "english",
    first_run_complete: false,
    pre_retrieval_strategy: "none",
    use_reranker: false,
    reranker_backend: "cross-encoder",
    chat_mode: "single",
    chat_permission_mode: "ask",
    ollama_base_url: "http://localhost:11434",
    chat_memory_turns: 6,
    memory_compression_threshold: 20,
    custom_system_prompt: "",
  });
});

test("saveConfig then loadConfig round-trips all fields", () => {
  const dir = tempDir();
  const cfg = AppConfigSchema.parse({
    llm_provider: "anthropic",
    model_name: "claude-sonnet-4-6",
    base_url: "https://api.anthropic.com",
    api_key: "sk-test",
    embedding_language: "mixed",
    first_run_complete: true,
    pre_retrieval_strategy: "multi_query",
    use_reranker: true,
    chat_memory_turns: 5,
    memory_compression_threshold: 30,
    custom_system_prompt: "be terse",
  });
  saveConfig(cfg, dir);
  expect(loadConfig(dir)).toEqual(cfg);
});

test("legacy use_hyde:true migrates to pre_retrieval_strategy:hyde", () => {
  const dir = tempDir();
  writeFileSync(configPath(dir), "use_hyde: true\n");
  expect(loadConfig(dir).pre_retrieval_strategy).toBe("hyde");
});

test("legacy use_hyde:false migrates to pre_retrieval_strategy:none", () => {
  const dir = tempDir();
  writeFileSync(configPath(dir), "use_hyde: false\n");
  expect(loadConfig(dir).pre_retrieval_strategy).toBe("none");
});

test("explicit pre_retrieval_strategy wins over legacy use_hyde", () => {
  const dir = tempDir();
  writeFileSync(configPath(dir), "use_hyde: true\npre_retrieval_strategy: multi_query\n");
  expect(loadConfig(dir).pre_retrieval_strategy).toBe("multi_query");
});

test("unknown keys in config.yaml are stripped (pydantic ignore-extra parity)", () => {
  const dir = tempDir();
  writeFileSync(configPath(dir), "model_name: qwen3\nsome_future_field: 42\n");
  const cfg = loadConfig(dir);
  expect(cfg.model_name).toBe("qwen3");
  expect("some_future_field" in cfg).toBe(false);
});

test("chat_mode defaults to single and survives legacy yaml without the field", () => {
  const dir = tempDir();
  writeFileSync(configPath(dir), "llm_provider: ollama\nmodel_name: llama3.2\n");
  expect(loadConfig(dir).chat_mode).toBe("single");
});

test("chat_mode accepts agentic and rejects unknown values", () => {
  expect(AppConfigSchema.parse({ chat_mode: "agentic" }).chat_mode).toBe("agentic");
  expect(() => AppConfigSchema.parse({ chat_mode: "yolo" })).toThrow();
});

test("cloud provider keeps embeddings on ollama_base_url (regression: DeepSeek 401)", () => {
  const cfg = AppConfigSchema.parse({
    llm_provider: "openai-compatible",
    base_url: "https://api.deepseek.com/v1",
  });
  expect(cfg.ollama_base_url).toBe("http://localhost:11434");
});
