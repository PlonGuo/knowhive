import { test, expect } from "bun:test";
import { buildOllamaStatus, requiredModels } from "./ollama.ts";
import { AppConfigSchema } from "../../shared/schema.ts";

// R3: /ollama/status core logic — required models derived from config, installed
// matching against Ollama /api/tags names (which carry ":latest"-style suffixes).

const cfg = (over: Record<string, unknown> = {}) => AppConfigSchema.parse(over);

test("ollama provider requires the chat model and the language's embedding model", () => {
  expect(requiredModels(cfg({ model_name: "llama3.2", embedding_language: "english" }))).toEqual([
    { name: "llama3.2", purpose: "chat" },
    { name: "nomic-embed-text", purpose: "embedding" },
  ]);
});

test("mixed language maps to bge-m3 for embedding", () => {
  expect(requiredModels(cfg({ embedding_language: "mixed" }))).toContainEqual({
    name: "bge-m3",
    purpose: "embedding",
  });
});

test("cloud providers still require the local embedding model but not the chat model", () => {
  const models = requiredModels(cfg({ llm_provider: "anthropic", model_name: "claude-sonnet-4-6" }));
  expect(models).toEqual([{ name: "nomic-embed-text", purpose: "embedding" }]);
});

test("buildOllamaStatus matches installed models with or without tag suffix", () => {
  const status = buildOllamaStatus(["llama3.2:latest", "bge-m3:567m"], cfg({ embedding_language: "mixed" }));
  expect(status).toEqual({
    running: true,
    models: ["llama3.2:latest", "bge-m3:567m"],
    required: [
      { name: "llama3.2", purpose: "chat", installed: true },
      { name: "bge-m3", purpose: "embedding", installed: true },
    ],
  });
});

test("buildOllamaStatus flags missing models", () => {
  const status = buildOllamaStatus(["mistral:latest"], cfg({}));
  expect(status.required).toEqual([
    { name: "llama3.2", purpose: "chat", installed: false },
    { name: "nomic-embed-text", purpose: "embedding", installed: false },
  ]);
});

test("an exact model name with tag in config matches only itself", () => {
  const status = buildOllamaStatus(["qwen3:8b"], cfg({ model_name: "qwen3:8b" }));
  expect(status.required[0]).toEqual({ name: "qwen3:8b", purpose: "chat", installed: true });
});
