// RAG chat route, extracted from index.ts with injected deps so the streaming
// pipeline is testable with ai/test mock models (no Ollama needed).
//
// Two modes (body.mode ?? config.chat_mode):
//   single  — retrieve once → inject context into the system prompt → stream.
//   agentic — Phase G tool-use loop: same pre-retrieval (a model that never calls
//             tools degrades to single-pass, not to zero context) + read-only tools
//             the model can call for follow-up hops. Provider-agnostic: any model
//             reachable via chatModel() (ollama/openai-compatible/anthropic) runs
//             the same loop.
import { Hono } from "hono";
import {
  stepCountIs,
  streamText,
  type LanguageModel,
  type ModelMessage,
  type UIMessage,
} from "ai";
import type { AppConfig, ChatMode } from "../../shared/schema.ts";
import { SourceCollector, buildAgentTools } from "./agentTools.ts";
import { buildAgentSystemPrompt, buildSystemPrompt, extractSources, uiMessageText } from "./rag.ts";
import type { ChunkRow } from "./store.ts";

// 6 steps = pre-retrieval-backed first answer + up to 4 tool hops + guarded finale.
// The spike caught a runaway 40-calls-in-one-step failure mode; the cap plus the
// no-tools final step below are the structural containment for it.
export const MAX_AGENT_STEPS = 6;

export interface ChatRoutesDeps {
  getConfig: () => AppConfig;
  /** Fresh model per call so config changes take effect without restart. */
  chatModel: () => LanguageModel;
  retrieve: (query: string, k: number) => Promise<ChunkRow[]>;
  /** Read a note by knowledge-dir-relative path (throws SafePathError / not-found). */
  readNote: (relPath: string) => { path: string; content: string };
  listNotePaths: () => string[];
}

export function chatRoutes(deps: ChatRoutesDeps): Hono {
  const app = new Hono();

  app.post("/chat", async (c) => {
    const { messages, mode } = (await c.req.json()) as {
      messages: UIMessage[];
      mode?: ChatMode;
    };
    const config = deps.getConfig();
    const chatMode: ChatMode = mode ?? config.chat_mode;

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = uiMessageText(lastUser);
    const chunks = question ? await deps.retrieve(question, 5) : [];

    // Map UIMessages → plain model messages (avoids v7 convertToModelMessages quirks).
    const modelMessages: ModelMessage[] = messages
      .map((m) => ({ role: m.role, content: uiMessageText(m) }) as ModelMessage)
      .filter((m) => typeof m.content === "string" && m.content.length > 0);

    if (chatMode === "agentic") {
      // Sources accumulate across steps: pre-retrieval now, tool hits as they execute.
      const sources = new SourceCollector();
      sources.add(...extractSources(chunks));

      const result = streamText({
        model: deps.chatModel(),
        system: buildAgentSystemPrompt(chunks, config.custom_system_prompt),
        messages: modelMessages,
        tools: buildAgentTools({
          retrieve: deps.retrieve,
          readNote: deps.readNote,
          listNotePaths: deps.listNotePaths,
          sources,
        }),
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        // Final allowed step: physically remove the tools so the model can only
        // produce text — a structural guarantee, not a prompt-level plea.
        prepareStep: ({ stepNumber }) =>
          stepNumber >= MAX_AGENT_STEPS - 1
            ? { activeTools: [], toolChoice: "none" as const }
            : undefined,
      });

      // messageMetadata fires on start (pre-retrieval sources render early) and on
      // finish (all tool executes done → full aggregate).
      return result.toUIMessageStreamResponse({
        messageMetadata: () => ({ sources: sources.list() }),
      });
    }

    const result = streamText({
      model: deps.chatModel(),
      system: buildSystemPrompt(chunks, config.custom_system_prompt),
      messages: modelMessages,
    });

    // Surface retrieved sources to the UI as message metadata.
    return result.toUIMessageStreamResponse({
      messageMetadata: () => ({ sources: extractSources(chunks) }),
    });
  });

  return app;
}
