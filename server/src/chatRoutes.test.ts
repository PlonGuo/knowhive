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
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
        ],
      }),
    },
  });
}

/** Mock model: first call issues a search_knowledge tool call, second call answers. */
function toolThenTextModel(query: string, answer: string) {
  return new MockLanguageModelV3({
    doStream: [
      {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "search_knowledge",
              input: JSON.stringify({ query }),
            },
            { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE },
          ],
        }),
      },
      {
        stream: simulateReadableStream<LanguageModelV3StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: answer },
            { type: "text-end", id: "t1" },
            { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
          ],
        }),
      },
    ],
  });
}

function makeDeps(overrides: Partial<ChatRoutesDeps> = {}): ChatRoutesDeps {
  const config: AppConfig = AppConfigSchema.parse({});
  return {
    getConfig: () => config,
    chatModel: () => textOnlyModel("hello") as never,
    retrieve: async () => [chunk("notes/pre.md", "prefetched context")],
    readNote: () => ({ path: "notes/pre.md", content: "# full note" }),
    listNotePaths: () => ["notes/pre.md"],
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

describe("agentic mode", () => {
  test("body.mode=agentic runs the tool loop and aggregates tool-hit sources", async () => {
    const retrieved: string[] = [];
    const deps = makeDeps({
      chatModel: () => toolThenTextModel("digit dp", "answer!") as never,
      retrieve: async (query) => {
        retrieved.push(query);
        return query === "digit dp"
          ? [chunk("notes/digit.md", "digit dp content")]
          : [chunk("notes/pre.md", "prefetched context")];
      },
    });
    const sse = await postChat(deps, { ...userMessage("compare dps"), mode: "agentic" });
    // tool chunks surfaced to the UI stream
    expect(sse).toContain('"type":"tool-input-available"');
    expect(sse).toContain("search_knowledge");
    expect(sse).toContain('"type":"tool-output-available"');
    // final text still streams
    expect(sse).toContain("answer!");
    // finish metadata aggregates pre-retrieval + tool-hit sources
    expect(sse).toContain('"sources":["notes/pre.md","notes/digit.md"]');
    // both the pre-retrieval and the tool call hit retrieve
    expect(retrieved).toEqual(["compare dps", "digit dp"]);
  });

  test("config.chat_mode=agentic enables the loop without a body override", async () => {
    const config = AppConfigSchema.parse({ chat_mode: "agentic" });
    const model = toolThenTextModel("q2", "done");
    const deps = makeDeps({ getConfig: () => config, chatModel: () => model as never });
    const sse = await postChat(deps, userMessage("q"));
    expect(sse).toContain('"type":"tool-input-available"');
    expect(sse).toContain("done");
  });

  test("agentic requests expose tools to the model; system prompt has tool guidance", async () => {
    const model = toolThenTextModel("q3", "t");
    await postChat(makeDeps({ chatModel: () => model as never }), {
      ...userMessage("q"),
      mode: "agentic",
    });
    const call = model.doStreamCalls[0]!;
    expect((call.tools ?? []).map((t) => t.name).sort()).toEqual([
      "list_notes",
      "read_note",
      "search_knowledge",
    ]);
    expect(JSON.stringify(call.prompt.find((m) => m.role === "system"))).toContain(
      "search_knowledge",
    );
  });

  test("the final allowed step physically disables tools (prepareStep guard)", async () => {
    // Model that always wants to call tools — the guard must cut it off at the cap.
    let callSeq = 0;
    const alwaysToolStream = () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: `call-${++callSeq}`,
            toolName: "search_knowledge",
            input: JSON.stringify({ query: "again" }),
          },
          { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: USAGE },
        ],
      }),
    });
    const finalTextStream = () => ({
      stream: simulateReadableStream<LanguageModelV3StreamPart>({
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          { type: "text-delta", id: "t1", delta: "forced answer" },
          { type: "text-end", id: "t1" },
          { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: USAGE },
        ],
      }),
    });
    // 5 tool-hungry steps, then the guarded final step answers.
    const model = new MockLanguageModelV3({
      doStream: [
        alwaysToolStream(),
        alwaysToolStream(),
        alwaysToolStream(),
        alwaysToolStream(),
        alwaysToolStream(),
        finalTextStream(),
      ],
    });
    await postChat(makeDeps({ chatModel: () => model as never }), {
      ...userMessage("loop forever"),
      mode: "agentic",
    });
    expect(model.doStreamCalls.length).toBe(6);
    const lastCall = model.doStreamCalls.at(-1)!;
    expect(lastCall.tools ?? []).toHaveLength(0);
  });
});
