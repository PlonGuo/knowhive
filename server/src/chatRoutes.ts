// RAG chat route, extracted from index.ts with injected deps so the streaming
// pipeline is testable with ai/test mock models (no Ollama needed).
//
// Modes (body.mode ?? config.chat_mode):
//   single  — retrieve once → inject context into the system prompt → stream.
//   agentic — Phase G tool-use loop: same pre-retrieval (a model that never calls
//             tools degrades to single-pass, not to zero context) + read-only tools.
//
// Sessions (Phase M, body.session_id): history is loaded server-side (last N turns
// verbatim + rolling summary above the watermark), the exchange is persisted after
// the stream finishes, and a fire-and-forget hook compresses old turns — the same
// LLM pass distills durable facts into the memories table (zero extra calls).
import { Hono } from "hono";
import {
  convertToModelMessages,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import type { Database } from "bun:sqlite";
import type { AppConfig, ChatMode } from "../../shared/schema.ts";
import { SourceCollector, buildAgentTools } from "./agentTools.ts";
import {
  buildChatContext,
  buildDistillationPrompt,
  buildUserPreface,
  needsCompression,
  parseDistillation,
  sliceForCompression,
} from "./memory.ts";
import { toolApprovalFor, writeToolsEnabled } from "./permissions.ts";
import {
  buildAgentSystemPrompt,
  buildContextBlock,
  buildSystemPrompt,
  extractSources,
  uiMessageText,
} from "./rag.ts";
import { encodeVector } from "./retrieval.ts";
import { appendMessage, getMessages, runEviction, searchEpisodic, setSessionTitle, type MessageRow } from "./sessions.ts";
import type { ChunkRow } from "./store.ts";

// 6 steps = pre-retrieval-backed first answer + up to 4 tool hops + guarded finale.
export const MAX_AGENT_STEPS = 6;
const TITLE_MAX_CHARS = 40;
export const EVICTION_POLICY = { maxSemantic: 200, episodicTtlDays: 90 };

export interface ChatRoutesDeps {
  getConfig: () => AppConfig;
  /** Fresh model per call so config changes take effect without restart. */
  chatModel: () => LanguageModel;
  /** Optional precomputed query vector skips retrieve's internal embed — lets /chat
   * embed the question once and share it with recall (latency: kills a redundant
   * ~156ms Ollama round-trip, see learnings/evals/Latency-Waterfall.md). */
  retrieve: (query: string, k: number, queryVector?: number[]) => Promise<ChunkRow[]>;
  /** Embed one query string (for the embed-once/reuse dedup). */
  embedQuery?: (text: string) => Promise<number[]>;
  /** Read a note by knowledge-dir-relative path (throws SafePathError / not-found). */
  readNote: (relPath: string) => { path: string; content: string };
  listNotePaths: () => string[];
  db: Database;
  /** Plain-text generation for the summarizer (compression + distillation). */
  generate: (prompt: string) => Promise<string>;
  /** Recall semantic memories relevant to the question (Phase M Task 3; optional).
   * Accepts the shared query vector to avoid re-embedding the question. */
  recallMemories?: (question: string, queryVector?: number[]) => Promise<string[]>;
  /** Embed distilled facts for future recall (Phase M Task 3; optional). */
  embedFacts?: (facts: string[]) => Promise<number[][]>;
  /** Note write operations for agent write tools (Phase H; optional). Whether they
   * are mounted and how they're gated is decided by chat_permission_mode. */
  writeNotes?: {
    create: (relPath: string, content: string) => Promise<{ path: string; bytes: number }>;
    update: (relPath: string, content: string) => Promise<{ path: string; bytes: number }>;
    remove: (relPath: string) => Promise<{ path: string }>;
  };
}

interface SessionState {
  history: MessageRow[];
  summary: string | undefined;
  watermark: number;
}

/** Prepend the volatile preface (summary + memories + retrieved context) to the
 * last user message. Keeping it here — not in the system prompt — preserves a
 * stable, cacheable system+history prefix (Tier 1-3). No-op when empty or when the
 * tail isn't a fresh user turn (e.g. an approval continuation). */
function withPreface(msgs: ModelMessage[], preface: string): ModelMessage[] {
  if (!preface) return msgs;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]!;
    if (m.role === "user" && typeof m.content === "string") {
      const copy = [...msgs];
      // Label the real question so it's unmistakably separate from any instruction
      // embedded in the untrusted context above it (spotlighting reinforcement).
      copy[i] = { ...m, content: `${preface}\n\nMy question (answer only this): ${m.content}` };
      return copy;
    }
  }
  return msgs;
}

function loadSessionState(db: Database, sessionId: string): SessionState {
  const history = getMessages(db, sessionId);
  const row = db
    .query(
      "SELECT summary, last_message_id FROM chat_summaries WHERE session_id = ? ORDER BY last_message_id DESC LIMIT 1",
    )
    .get(sessionId) as { summary: string; last_message_id: number } | null;
  return { history, summary: row?.summary, watermark: row?.last_message_id ?? 0 };
}

export function chatRoutes(deps: ChatRoutesDeps): Hono {
  const app = new Hono();

  /** Persist the exchange, then compress+distill when the unsummarized backlog
   * exceeds the threshold. Failures only log — memory must never break chat. */
  async function afterExchange(sessionId: string, question: string, answer: string, sources: string[]) {
    const config = deps.getConfig();
    appendMessage(deps.db, sessionId, { role: "user", content: question });
    appendMessage(deps.db, sessionId, { role: "assistant", content: answer, sources });
    setSessionTitle(deps.db, sessionId, question.slice(0, TITLE_MAX_CHARS));
    deps.db.run("INSERT INTO memories (kind, session_id, content) VALUES ('episodic', ?, ?)", [
      sessionId,
      JSON.stringify({ question, answer: answer.slice(0, 500), sources }),
    ]);

    const { history, summary, watermark } = loadSessionState(deps.db, sessionId);
    const unsummarized = history.filter((m) => m.id > watermark).length;
    if (!needsCompression(unsummarized, config.memory_compression_threshold)) return;

    const slice = sliceForCompression(history, watermark, config.chat_memory_turns);
    if (slice.length === 0) return;
    const distilled = parseDistillation(await deps.generate(buildDistillationPrompt(slice, summary)));
    if (!distilled.summary) return; // summarizer failed — leave the watermark, retry next turn
    deps.db.run(
      "INSERT INTO chat_summaries (summary, first_message_id, last_message_id, session_id) VALUES (?, ?, ?, ?)",
      [distilled.summary, slice[0]!.id, slice.at(-1)!.id, sessionId],
    );
    // Preferences become procedural rows (no embedding — injected unconditionally).
    for (const pref of distilled.preferences) {
      const exists = deps.db
        .query("SELECT 1 FROM memories WHERE kind = 'procedural' AND content = ?")
        .get(pref);
      if (!exists) {
        deps.db.run("INSERT INTO memories (kind, session_id, content) VALUES ('procedural', ?, ?)", [
          sessionId,
          pref,
        ]);
      }
    }
    if (distilled.facts.length > 0) {
      // Dedupe by exact content — repeated compressions re-derive the same facts.
      const fresh = distilled.facts.filter(
        (fact) =>
          !deps.db
            .query("SELECT 1 FROM memories WHERE kind = 'semantic' AND content = ?")
            .get(fact),
      );
      const embeddings = deps.embedFacts && fresh.length > 0 ? await deps.embedFacts(fresh) : [];
      fresh.forEach((fact, i) => {
        deps.db.run(
          "INSERT INTO memories (kind, session_id, content, embedding) VALUES ('semantic', ?, ?, ?)",
          [sessionId, fact, embeddings[i] ? encodeVector(embeddings[i]!) : null],
        );
      });
    }
    runEviction(deps.db, EVICTION_POLICY);
  }

  app.post("/chat", async (c) => {
    const { messages, mode, session_id } = (await c.req.json()) as {
      messages: UIMessage[];
      mode?: ChatMode;
      session_id?: string;
    };
    const config = deps.getConfig();
    const chatMode: ChatMode = mode ?? config.chat_mode;

    // Env-gated latency instrumentation (KNOWHIVE_TIMING=1). Off by default → zero
    // cost + no behavior change. Stage times ride messageMetadata so a probe reads
    // them from the stream; the LLM TTFT is the probe's first-delta minus preLlmMs.
    const timing = process.env.KNOWHIVE_TIMING
      ? ({ t0: performance.now() } as { t0: number; retrieve?: number; ready?: number })
      : null;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = uiMessageText(lastUser);
    // Embed the question once and share the vector with retrieve + recall (dedup).
    const queryVector = question && deps.embedQuery ? await deps.embedQuery(question) : undefined;
    const chunks = question ? await deps.retrieve(question, 5, queryVector) : [];
    if (timing) timing.retrieve = performance.now() - timing.t0;
    const contextBlock = buildContextBlock(chunks);

    // Session mode: server-side history is the source of truth (recent window +
    // summary); stateless mode maps the client's transient array as before.
    // Tier 1-3: the system prompt holds only STABLE content (instructions live in
    // systemExtra); volatile summary + memories + retrieved context go into a
    // preface on the current user message so the cache prefix spans the session.
    let modelMessages: ModelMessage[];
    let systemExtra = "";
    let preface: string;
    if (session_id) {
      const state = loadSessionState(deps.db, session_id);
      const recalled = question && deps.recallMemories ? await deps.recallMemories(question, queryVector) : [];
      const instructions = (
        deps.db.query("SELECT content FROM memories WHERE kind = 'procedural' ORDER BY id").all() as {
          content: string;
        }[]
      ).map((r) => r.content);
      const ctx = buildChatContext({
        history: state.history,
        turns: config.chat_memory_turns,
        instructions,
      });
      modelMessages = [...ctx.modelMessages, { role: "user", content: question }];
      systemExtra = ctx.systemExtra;
      preface = buildUserPreface({ summary: state.summary, memories: recalled, context: contextBlock });
    } else {
      modelMessages = messages
        .map((m) => ({ role: m.role, content: uiMessageText(m) }) as ModelMessage)
        .filter((m) => typeof m.content === "string" && m.content.length > 0);
      preface = buildUserPreface({ context: contextBlock });
    }

    if (timing) timing.ready = performance.now() - timing.t0;
    // Stage times folded into messageMetadata when instrumentation is on.
    const timings = timing
      ? { retrieveMs: Math.round(timing.retrieve ?? 0), preLlmMs: Math.round(timing.ready ?? 0) }
      : undefined;

    const withExtra = (base: string) => (systemExtra ? `${base}\n\n${systemExtra}` : base);
    const persist = (answer: string, sources: string[]) => {
      if (!session_id || !question) return;
      afterExchange(session_id, question, answer, sources).catch((err) =>
        console.error("[memory] post-exchange hook failed:", err),
      );
    };

    if (chatMode === "agentic") {
      const sources = new SourceCollector();
      sources.add(...extractSources(chunks));

      const permissionMode = config.chat_permission_mode;
      const tools = buildAgentTools({
        retrieve: deps.retrieve,
        readNote: deps.readNote,
        listNotePaths: deps.listNotePaths,
        sources,
        // Past-conversation search only makes sense with a session.
        searchHistory: session_id ? (q) => searchEpisodic(deps.db, q, 5) : undefined,
        // readonly mode: write tools are not mounted at all (fail-closed).
        writeNotes: writeToolsEnabled(permissionMode) ? deps.writeNotes : undefined,
      });

      // Approval continuation: the client re-sent the conversation with the user's
      // Allow/Deny recorded on the pending tool call. Those parts must round-trip
      // intact, so this path uses the official UIMessage→ModelMessage conversion
      // instead of our text-only mapping. No preface here — context was already
      // supplied on the first pass; the tail is an approval turn, not a fresh question.
      const isContinuation = lastAssistantMessageIsCompleteWithApprovalResponses({ messages });
      const agenticMessages = isContinuation
        ? await convertToModelMessages(messages, { tools, ignoreIncompleteToolCalls: true })
        : withPreface(modelMessages, preface);

      const result = streamText({
        model: deps.chatModel(),
        system: withExtra(buildAgentSystemPrompt(config.custom_system_prompt)),
        messages: agenticMessages,
        tools,
        toolApproval: toolApprovalFor(permissionMode),
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        prepareStep: ({ stepNumber }) =>
          stepNumber >= MAX_AGENT_STEPS - 1
            ? { activeTools: [], toolChoice: "none" as const }
            : undefined,
        // Persist only on real completion — an approval pause ends this stream with
        // finishReason 'tool-calls'; the continuation request persists the exchange.
        onFinish: ({ text, finishReason }) => {
          if (finishReason === "stop") persist(text, sources.list());
        },
      });

      return result.toUIMessageStreamResponse({
        messageMetadata: () => ({ sources: sources.list(), ...(timings ? { timings } : {}) }),
      });
    }

    const result = streamText({
      model: deps.chatModel(),
      system: withExtra(buildSystemPrompt(config.custom_system_prompt)),
      messages: withPreface(modelMessages, preface),
      onFinish: ({ text }) => persist(text, extractSources(chunks)),
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: () => ({ sources: extractSources(chunks), ...(timings ? { timings } : {}) }),
    });
  });

  return app;
}
