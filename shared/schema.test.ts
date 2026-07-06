import { expect, test } from "bun:test";
import { AppConfigSchema } from "./schema.ts";

test("reranker_backend defaults to llm", () => {
  const cfg = AppConfigSchema.parse({});
  expect(cfg.reranker_backend).toBe("llm");
});

test("reranker_backend accepts cross-encoder", () => {
  const cfg = AppConfigSchema.parse({ reranker_backend: "cross-encoder" });
  expect(cfg.reranker_backend).toBe("cross-encoder");
});
