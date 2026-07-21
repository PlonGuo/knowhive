import { expect, test } from "bun:test";
import { AppConfigSchema } from "./schema.ts";

test("reranker_backend defaults to cross-encoder (Phase E2 RAGAS gate winner)", () => {
  const cfg = AppConfigSchema.parse({});
  expect(cfg.reranker_backend).toBe("cross-encoder");
});

test("reranker_backend accepts the llm fallback", () => {
  const cfg = AppConfigSchema.parse({ reranker_backend: "llm" });
  expect(cfg.reranker_backend).toBe("llm");
});
