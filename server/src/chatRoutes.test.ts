import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";
import { chatRoutes, type ChatRoutesDeps } from "./chatRoutes.ts";
import type { ChunkRow } from "./store.ts";

function chunk(file_path: string, content: string): ChunkRow {
  return {
    id: 0,
    file_path,
    chunk_index: 0,
    content,
    section_heading: null,
    title: null,
    category: null,
    tags: null,
    difficulty: null,
    pack_id: null,
  };
}

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
  raw: undefined,
} as never;

/** Mock model that streams plain text (no tool calls). */
function textOnlyModel(text: string) {
  return new MockLanguageModelV3({
    doStream: {
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: text },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: "stop", usage: USAGE },
        ],
      }),
    },
  });
}

function makeDeps(overrides: Partial<ChatRoutesDeps> = {}): ChatRoutesDeps {
  const config: AppConfig = AppConfigSchema.parse({});
  return {
    getConfig: () => config,
    chatModel: () => textOnlyModel("hello") as never,
    retrieve: async () => [chunk("notes/pre.md", "prefetched context")],
    ...overrides,
  };
}

const userMessage = (text: string) => ({
  messages: [{ id: "1", role: "user", parts: [{ type: "text", text }] }],
});

async function postChat(deps: ChatRoutesDeps, body: unknown): Promise<string> {
  const app = chatRoutes(deps);
  const res = await app.request("/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return await res.text();
}

describe("single-pass mode (default)", () => {
  test("streams text deltas with pre-retrieved sources in metadata", async () => {
    const sse = await postChat(makeDeps(), userMessage("what is RRF?"));
    expect(sse).toContain('"type":"text-delta"');
    expect(sse).toContain("hello");
    expect(sse).toContain('"sources":["notes/pre.md"]');
    expect(sse).not.toContain("tool-input");
  });

  test("injects retrieved context into the system prompt", async () => {
    const model = textOnlyModel("ok");
    await postChat(makeDeps({ chatModel: () => model as never }), userMessage("q"));
    const call = model.doStreamCalls[0]!;
    const system = JSON.stringify(call.prompt.find((m) => m.role === "system"));
    expect(system).toContain("prefetched context");
    expect(call.tools ?? []).toHaveLength(0);
  });
});
