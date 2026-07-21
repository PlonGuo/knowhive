// LLM connectivity probe. Ports backend/app/routers/config.py:test_llm_endpoint.
// Request construction is pure (unit-tested); the HTTP call takes an injectable fetch.
import type { AppConfig } from "../../shared/schema.ts";

export interface TestLlmRequest {
  url: string;
  headers: Record<string, string>;
}

export type TestLlmResult =
  | { success: true; message: string }
  | { success: false; error: string };

/** Minimal fetch signature so tests can inject a fake without matching bun's full fetch type. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const TIMEOUT_MS = 10_000;

export function buildTestLlmRequest(config: AppConfig): TestLlmRequest {
  const base = config.base_url.replace(/\/+$/, "");
  switch (config.llm_provider) {
    case "ollama":
      return { url: `${base}/api/tags`, headers: {} };
    case "anthropic": {
      const headers: Record<string, string> = { "anthropic-version": "2023-06-01" };
      if (config.api_key) headers["x-api-key"] = config.api_key;
      return { url: `${base}/v1/models`, headers };
    }
    default: {
      // OpenAI-compatible: GET {base}/models
      const headers: Record<string, string> = {};
      if (config.api_key) headers.Authorization = `Bearer ${config.api_key}`;
      return { url: `${base}/models`, headers };
    }
  }
}

export async function runTestLlm(
  config: AppConfig,
  fetchFn: FetchLike = fetch,
): Promise<TestLlmResult> {
  const { url, headers } = buildTestLlmRequest(config);
  try {
    const resp = await fetchFn(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (resp.status === 200) {
      return { success: true, message: "LLM connection successful" };
    }
    return { success: false, error: `LLM returned status ${resp.status}` };
  } catch (err) {
    return { success: false, error: `Connection failed: ${(err as Error).message}` };
  }
}
