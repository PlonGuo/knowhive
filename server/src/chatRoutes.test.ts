import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider";
import { AppConfigSchema, type AppConfig } from "../../shared/schema.ts";
import { chatRoutes, type ChatRoutesDeps } from "./chatRoutes.ts";
import { openDbAt } from "./db.ts";
import { appendMessage, createSession, getMessages } from "./sessions.ts";
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
    db: openDbAt(":memory:"),
    generate: async () => '{"summary":"","facts":[]}',
    ...overrides,
  };
}

/** Post-exchange hooks are fire-and-forget — give them a beat to land. */
const settle = () => new Promise((r) => setTimeout(r, 30));

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

describe("session mode (Phase M)", () => {
  test("persists the exchange, sets the title, and records an episodic memory", async () => {
    const deps = makeDeps();
    const sid = createSession(deps.db);
    await postChat(deps, { ...userMessage("什么是区间DP？"), session_id: sid });
    await settle();

    const msgs = getMessages(deps.db, sid);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(msgs[1]!.content).toBe("hello");
    expect(msgs[1]!.sources).toEqual(["notes/pre.md"]);

    const session = deps.db.query("SELECT title FROM sessions WHERE id = ?").get(sid) as {
      title: string;
    };
    expect(session.title).toBe("什么是区间DP？");

    const episodic = deps.db
      .query("SELECT content FROM memories WHERE kind = 'episodic' AND session_id = ?")
      .all(sid) as { content: string }[];
    expect(episodic.length).toBe(1);
    expect(JSON.parse(episodic[0]!.content).question).toBe("什么是区间DP？");
  });

  test("persisted history and summary are injected on the next turn", async () => {
    const config = AppConfigSchema.parse({ chat_memory_turns: 4 });
    const model = textOnlyModel("second answer");
    const deps = makeDeps({ getConfig: () => config, chatModel: () => model as never });
    const sid = createSession(deps.db);
    appendMessage(deps.db, sid, { role: "user", content: "earlier question about heaps" });
    appendMessage(deps.db, sid, { role: "assistant", content: "earlier answer about heaps" });
    deps.db.run(
      "INSERT INTO chat_summaries (summary, first_message_id, last_message_id, session_id) VALUES ('older turns summary', 0, 0, ?)",
      [sid],
    );

    await postChat(deps, { ...userMessage("follow-up"), session_id: sid });

    const call = model.doStreamCalls[0]!;
    const prompt = JSON.stringify(call.prompt);
    expect(prompt).toContain("earlier question about heaps");
    expect(prompt).toContain("older turns summary");
  });

  test("crossing the threshold compresses old turns and distills facts", async () => {
    const config = AppConfigSchema.parse({ chat_memory_turns: 2, memory_compression_threshold: 4 });
    const prompts: string[] = [];
    const deps = makeDeps({
      getConfig: () => config,
      generate: async (p) => {
        prompts.push(p);
        return '{"summary":"压缩后的摘要","facts":["用户在准备面试"]}';
      },
    });
    const sid = createSession(deps.db);
    for (let i = 0; i < 4; i++) {
      appendMessage(deps.db, sid, { role: i % 2 ? "assistant" : "user", content: `old-${i}` });
    }

    await postChat(deps, { ...userMessage("trigger"), session_id: sid });
    await settle();

    const summary = deps.db
      .query("SELECT summary FROM chat_summaries WHERE session_id = ?")
      .get(sid) as { summary: string } | null;
    expect(summary?.summary).toBe("压缩后的摘要");
    const facts = deps.db
      .query("SELECT content FROM memories WHERE kind = 'semantic'")
      .all() as { content: string }[];
    expect(facts.map((f) => f.content)).toEqual(["用户在准备面试"]);
    // the summarizer saw the old turns, not the fresh window
    expect(prompts[0]).toContain("old-0");
  });

  test("recalled memories are injected into the system prompt", async () => {
    const model = textOnlyModel("with memory");
    const deps = makeDeps({
      chatModel: () => model as never,
      recallMemories: async () => ["用户偏好中文回答"],
    });
    const sid = createSession(deps.db);
    await postChat(deps, { ...userMessage("hi"), session_id: sid });
    const system = JSON.stringify(model.doStreamCalls[0]!.prompt.find((m) => m.role === "system"));
    expect(system).toContain("用户偏好中文回答");
  });

  test("stateless requests (no session_id) behave exactly as before", async () => {
    const deps = makeDeps();
    const sse = await postChat(deps, userMessage("stateless"));
    await settle();
    expect(sse).toContain("hello");
    const count = deps.db.query("SELECT COUNT(*) AS n FROM chat_messages").get() as { n: number };
    expect(count.n).toBe(0);
  });
});
