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
import { traced, tracedOpen, withTraceAttributes, type OpenSpan } from "./tracing.ts";

/**
 * Request-scoped handoff for the chat span the middleware opens. Keyed by the raw
 * Request (a WeakMap, so an abandoned request cannot leak) rather than Hono context
 * variables, which would need the route's Env threaded through every signature.
 */
const chatSpans = new WeakMap<Request, { span: OpenSpan; claimed: boolean }>();

/**
 * Hand the chat span to the streaming layer: it now ends when the stream ends, not when
 * the handler returns. Returns a closer that is safe to call from several callbacks —
 * finish and error can both fire, and only the first close counts.
 */
function claimChatSpan(request: Request): { span: OpenSpan | null; close: () => void } {
  const handle = chatSpans.get(request);
  if (!handle) return { span: null, close: () => {} };
  handle.claimed = true;
  chatSpans.delete(request);
  return { span: handle.span, close: () => handle.span.end() };
}
import { SourceCollector, ToolBudget, buildAgentTools } from "./agentTools.ts";
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
  normalizeConversation,
  uiMessageText,
} from "./rag.ts";
import { encodeVector } from "./retrieval.ts";
import { appendMessage, getMessages, runEviction, searchEpisodic, setSessionTitle, type MessageRow } from "./sessions.ts";
import type { ChunkRow } from "./store.ts";

// 6 steps = pre-retrieval-backed first answer + up to 4 tool hops + guarded finale.
export const MAX_AGENT_STEPS = 6;
const TITLE_MAX_CHARS = 40;
export const EVICTION_POLICY = { maxSemantic: 200, episodicTtlDays: 90 };

/**
 * Wall-clock ceiling on one /chat generation.
 *
 * The agentic eval produced two 15-17 minute runs (920s / 1042s) because
 * stepCountIs() caps steps, not tool calls *within* a step — and nothing on the
 * chat path had a timeout at all (learnings/evals/Agentic-vs-SingleShot.md).
 * 180s is deliberately generous: a cold Ollama's first token alone can take tens
 * of seconds, and a long answer streams for a while. It exists to kill runaways,
 * not to police slow-but-working generations.
 */
const DEFAULT_CHAT_TIMEOUT_MS = 180_000;

function chatTimeoutMs(fromDeps?: number): number {
  return fromDeps ?? (Number(process.env.KNOWHIVE_CHAT_TIMEOUT_MS) || DEFAULT_CHAT_TIMEOUT_MS);
}

/** Timeout OR client disconnect — whichever fires first stops the upstream call. */
function abortSignalFor(timeoutMs: number, clientSignal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return clientSignal ? AbortSignal.any([clientSignal, timeout]) : timeout;
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string } | undefined)?.name ?? "";
  return name === "AbortError" || name === "TimeoutError" || /abort/i.test(String(err));
}

/** Surface a useful reason instead of the SDK's generic masked error string. */
function streamErrorMessage(timeoutMs: number) {
  return (error: unknown): string =>
    isAbort(error)
      ? `The response timed out after ${Math.round(timeoutMs / 1000)}s and was stopped. Try a narrower question, or turn Agent mode off if it is on.`
      : `Chat failed: ${(error as Error)?.message ?? String(error)}`;
}

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
  /** Wall-clock ceiling for one generation. Defaults to KNOWHIVE_CHAT_TIMEOUT_MS
   * or DEFAULT_CHAT_TIMEOUT_MS; injected so tests can use a tiny value. */
  chatTimeoutMs?: number;
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

  // One span per chat request, so retrieval and the LLM call land in the SAME tree
  // rather than two unrelated traces. Done as middleware on purpose: the handler body
  // stays untouched, and when tracing is off this is a straight pass-through to next().
  // Hono caches the parsed body, so reading session_id here does not consume it.
  //
  // The span outlives the middleware: the handler returns as soon as the stream starts,
  // so closing on return would time "how long until the first byte" and label it as the
  // whole request. The handler claims the span and closes it when the stream actually
  // finishes; if it never claims (validation error, throw), we close here.
  app.use("/chat", async (c, next) => {
    let sessionId: string | undefined;
    try {
      sessionId = ((await c.req.json()) as { session_id?: string }).session_id;
    } catch {
      // Malformed/absent body is the handler's problem to report, not ours.
    }
    return withTraceAttributes(sessionId ? { sessionId } : {}, () =>
      tracedOpen("chat", "chain", async (span) => {
        const handle = { span, claimed: false };
        chatSpans.set(c.req.raw, handle);
        try {
          await next();
        } finally {
          if (!handle.claimed) {
            chatSpans.delete(c.req.raw);
            span.end();
          }
        }
      }),
    );
  });

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
    // The span lives HERE, not in retrieve's embed branch: because of this dedup that
    // branch never runs on the chat path, so instrumenting it alone leaves the embed
    // step invisible in exactly the trace you care about.
    const queryVector =
      question && deps.embedQuery
        ? await traced("embed-query", "embedding", async (rec) => {
            const vec = await deps.embedQuery!(question);
            rec.set({ input: question, output: { dimensions: vec.length }, metadata: { sharedWith: ["retrieve", "recall"] } });
            return vec;
          })
        : undefined;
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
      // normalizeConversation, not just a filter: a stopped generation leaves an
      // empty assistant turn, and dropping it would put two user turns back to
      // back — a shape most providers reject.
      modelMessages = normalizeConversation(
        messages.map((m) => ({ role: m.role, content: uiMessageText(m) })),
      ) as ModelMessage[];
      preface = buildUserPreface({ context: contextBlock });
    }

    if (timing) timing.ready = performance.now() - timing.t0;
    // Stage times folded into messageMetadata when instrumentation is on.
    const timings = timing
      ? { retrieveMs: Math.round(timing.retrieve ?? 0), preLlmMs: Math.round(timing.ready ?? 0) }
      : undefined;

    const timeoutMs = chatTimeoutMs(deps.chatTimeoutMs);
    const abortSignal = abortSignalFor(timeoutMs, c.req.raw.signal);
    const rawOnStreamError = streamErrorMessage(timeoutMs);
    // The chat span now belongs to the stream. Everything past this point must close it
    // on every exit — completion, error, and abort alike — or the trace never exports.
    //
    // Closed from streamText's own onFinish, NOT toUIMessageStreamResponse's: passing an
    // onFinish there makes the SDK reassemble the final message list, which needs
    // `originalMessages` to resolve a tool call carried over from an approval pause and
    // otherwise throws "No tool invocation found for tool call ID". Observability must
    // not change the shape of the response — the approval-continuation test caught this.
    const chatSpan = claimChatSpan(c.req.raw);
    const onStreamError = (error: unknown) => {
      chatSpan.close();
      return rawOnStreamError(error);
    };
    abortSignal.addEventListener("abort", chatSpan.close, { once: true });

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
      // Fresh per request: the cap and the repeat-set must not leak across chats.
      const budget = new ToolBudget();
      const tools = buildAgentTools({
        retrieve: deps.retrieve,
        readNote: deps.readNote,
        listNotePaths: deps.listNotePaths,
        sources,
        // Past-conversation search only makes sense with a session.
        searchHistory: session_id ? (q) => searchEpisodic(deps.db, q, 5) : undefined,
        // readonly mode: write tools are not mounted at all (fail-closed).
        writeNotes: writeToolsEnabled(permissionMode) ? deps.writeNotes : undefined,
      }, budget);

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
        abortSignal,
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        prepareStep: ({ stepNumber }) =>
          stepNumber >= MAX_AGENT_STEPS - 1
            ? { activeTools: [], toolChoice: "none" as const }
            : undefined,
        // functionId is what separates the two arms in Langfuse — without it both
        // branches report as one anonymous generation and you cannot compare them.
        telemetry: { functionId: "chat-agentic" },
        // Persist only on real completion — an approval pause ends this stream with
        // finishReason 'tool-calls'; the continuation request persists the exchange.
        // The span closes on every finish reason: one span per HTTP request, and an
        // approval pause really is the end of THIS request.
        onFinish: ({ text, finishReason }) => {
          chatSpan.close();
          if (finishReason === "stop") persist(text, sources.list());
        },
      });

      return result.toUIMessageStreamResponse({
        onError: onStreamError,
        messageMetadata: withUsage(() => ({ sources: sources.list(), ...(timings ? { timings } : {}) })),
      });
    }

    const result = streamText({
      model: deps.chatModel(),
      system: withExtra(buildSystemPrompt(config.custom_system_prompt)),
      messages: withPreface(modelMessages, preface),
      abortSignal,
      telemetry: { functionId: "chat-single" },
      // Same guard as the agentic branch: a timeout/abort ends the stream with a
      // non-"stop" reason, and half an answer must not enter the history.
      onFinish: ({ text, finishReason }) => {
        chatSpan.close();
        if (finishReason === "stop") persist(text, extractSources(chunks));
      },
    });

    return result.toUIMessageStreamResponse({
      onError: onStreamError,
      messageMetadata: withUsage(() => ({ sources: extractSources(chunks), ...(timings ? { timings } : {}) })),
    });
  });

  return app;
}

/**
 * Wrap a messageMetadata factory so the finish part also carries token usage —
 * the client-side usage meter reads it off assistant-message metadata. inputTokens
 * is the whole prompt the model just saw, which doubles as "current context size"
 * for the local-model context gauge.
 */
function withUsage(base: () => Record<string, unknown>) {
  return ({
    part,
  }: {
    part: {
      type: string;
      totalUsage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        inputTokenDetails?: { cacheReadTokens?: number };
      };
    };
  }) => ({
    ...base(),
    ...(part.type === "finish" && part.totalUsage
      ? {
          usage: {
            inputTokens: part.totalUsage.inputTokens ?? null,
            outputTokens: part.totalUsage.outputTokens ?? null,
            totalTokens: part.totalUsage.totalTokens ?? null,
            // Prompt-cache hit size. The 0% -> 22% multi-turn result came from an
            // offline probe, but the provider reports this per request — passing it
            // through turns cache hit rate into a live signal at zero extra cost.
            // null (not 0) when the provider says nothing, so "no cache support" and
            // "cache missed" stay distinguishable.
            cachedInputTokens: part.totalUsage.inputTokenDetails?.cacheReadTokens ?? null,
          },
        }
      : {}),
  });
}
