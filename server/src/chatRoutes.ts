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
  needsCompression,
  parseDistillation,
  sliceForCompression,
} from "./memory.ts";
import { buildAgentSystemPrompt, buildSystemPrompt, extractSources, uiMessageText } from "./rag.ts";
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
  retrieve: (query: string, k: number) => Promise<ChunkRow[]>;
  /** Read a note by knowledge-dir-relative path (throws SafePathError / not-found). */
  readNote: (relPath: string) => { path: string; content: string };
  listNotePaths: () => string[];
  db: Database;
  /** Plain-text generation for the summarizer (compression + distillation). */
  generate: (prompt: string) => Promise<string>;
  /** Recall semantic memories relevant to the question (Phase M Task 3; optional). */
  recallMemories?: (question: string) => Promise<string[]>;
  /** Embed distilled facts for future recall (Phase M Task 3; optional). */
  embedFacts?: (facts: string[]) => Promise<number[][]>;
}

interface SessionState {
  history: MessageRow[];
  summary: string | undefined;
  watermark: number;
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

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = uiMessageText(lastUser);
    const chunks = question ? await deps.retrieve(question, 5) : [];

    // Session mode: server-side history is the source of truth (recent window +
    // summary); stateless mode maps the client's transient array as before.
    let modelMessages: ModelMessage[];
    let systemExtra = "";
    if (session_id) {
      const state = loadSessionState(deps.db, session_id);
      const recalled = question && deps.recallMemories ? await deps.recallMemories(question) : [];
      const instructions = (
        deps.db.query("SELECT content FROM memories WHERE kind = 'procedural' ORDER BY id").all() as {
          content: string;
        }[]
      ).map((r) => r.content);
      const ctx = buildChatContext({
        history: state.history,
        turns: config.chat_memory_turns,
        summary: state.summary,
        memories: recalled,
        instructions,
      });
      modelMessages = [...ctx.modelMessages, { role: "user", content: question }];
      systemExtra = ctx.systemExtra;
    } else {
      modelMessages = messages
        .map((m) => ({ role: m.role, content: uiMessageText(m) }) as ModelMessage)
        .filter((m) => typeof m.content === "string" && m.content.length > 0);
    }

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

      const result = streamText({
        model: deps.chatModel(),
        system: withExtra(buildAgentSystemPrompt(chunks, config.custom_system_prompt)),
        messages: modelMessages,
        tools: buildAgentTools({
          retrieve: deps.retrieve,
          readNote: deps.readNote,
          listNotePaths: deps.listNotePaths,
          sources,
          // Past-conversation search only makes sense with a session.
          searchHistory: session_id ? (q) => searchEpisodic(deps.db, q, 5) : undefined,
        }),
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        prepareStep: ({ stepNumber }) =>
          stepNumber >= MAX_AGENT_STEPS - 1
            ? { activeTools: [], toolChoice: "none" as const }
            : undefined,
        onFinish: ({ text }) => persist(text, sources.list()),
      });

      return result.toUIMessageStreamResponse({
        messageMetadata: () => ({ sources: sources.list() }),
      });
    }

    const result = streamText({
      model: deps.chatModel(),
      system: withExtra(buildSystemPrompt(chunks, config.custom_system_prompt)),
      messages: modelMessages,
      onFinish: ({ text }) => persist(text, extractSources(chunks)),
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: () => ({ sources: extractSources(chunks) }),
    });
  });

  return app;
}
