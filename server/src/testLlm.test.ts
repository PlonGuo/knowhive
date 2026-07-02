import { test, expect } from "bun:test";
import { buildTestLlmRequest, runTestLlm } from "./testLlm.ts";
import { AppConfigSchema } from "../../shared/schema.ts";

// Parity tests against backend/app/routers/config.py:test_llm_endpoint.

const cfg = (over: Record<string, unknown>) => AppConfigSchema.parse(over);

test("ollama probes GET {base}/api/tags with no headers", () => {
  const req = buildTestLlmRequest(cfg({ llm_provider: "ollama" }));
  expect(req.url).toBe("http://localhost:11434/api/tags");
  expect(req.headers).toEqual({});
});

test("anthropic probes {base}/v1/models with version header and x-api-key", () => {
  const req = buildTestLlmRequest(
    cfg({ llm_provider: "anthropic", base_url: "https://api.anthropic.com", api_key: "sk-a" }),
  );
  expect(req.url).toBe("https://api.anthropic.com/v1/models");
  expect(req.headers).toEqual({ "anthropic-version": "2023-06-01", "x-api-key": "sk-a" });
});

test("anthropic without api_key omits x-api-key", () => {
  const req = buildTestLlmRequest(
    cfg({ llm_provider: "anthropic", base_url: "https://api.anthropic.com" }),
  );
  expect(req.headers).toEqual({ "anthropic-version": "2023-06-01" });
});

test("openai-compatible probes {base}/models with Bearer auth", () => {
  const req = buildTestLlmRequest(
    cfg({ llm_provider: "openai-compatible", base_url: "https://api.openai.com/v1", api_key: "sk-o" }),
  );
  expect(req.url).toBe("https://api.openai.com/v1/models");
  expect(req.headers).toEqual({ Authorization: "Bearer sk-o" });
});

test("trailing slashes on base_url are stripped", () => {
  const req = buildTestLlmRequest(cfg({ llm_provider: "ollama", base_url: "http://localhost:11434//" }));
  expect(req.url).toBe("http://localhost:11434/api/tags");
});

test("runTestLlm maps 200 to success", async () => {
  const fakeFetch = async () => new Response("{}", { status: 200 });
  const res = await runTestLlm(cfg({}), fakeFetch);
  expect(res).toEqual({ success: true, message: "LLM connection successful" });
});

test("runTestLlm maps non-200 to an error with the status code", async () => {
  const fakeFetch = async () => new Response("nope", { status: 401 });
  const res = await runTestLlm(cfg({}), fakeFetch);
  expect(res).toEqual({ success: false, error: "LLM returned status 401" });
});

test("runTestLlm maps a thrown fetch error to a connection failure", async () => {
  const fakeFetch = async () => {
    throw new TypeError("Unable to connect");
  };
  const res = await runTestLlm(cfg({}), fakeFetch);
  expect(res.success).toBe(false);
  expect((res as { error: string }).error).toContain("Connection failed");
});
