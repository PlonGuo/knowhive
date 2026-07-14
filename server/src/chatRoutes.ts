// RAG chat route, extracted from index.ts with injected deps so the streaming
// pipeline is testable with ai/test mock models (no Ollama needed).
// Single-pass mode: retrieve once → inject context into the system prompt → stream.
import { Hono } from "hono";
import { streamText, type LanguageModel, type ModelMessage, type UIMessage } from "ai";
import type { AppConfig } from "../../shared/schema.ts";
import { buildSystemPrompt, extractSources, uiMessageText } from "./rag.ts";
import type { ChunkRow } from "./store.ts";

export interface ChatRoutesDeps {
  getConfig: () => AppConfig;
  /** Fresh model per call so config changes take effect without restart. */
  chatModel: () => LanguageModel;
  retrieve: (query: string, k: number) => Promise<ChunkRow[]>;
}

export function chatRoutes(deps: ChatRoutesDeps): Hono {
  const app = new Hono();

  app.post("/chat", async (c) => {
    const { messages } = (await c.req.json()) as { messages: UIMessage[] };
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const question = uiMessageText(lastUser);

    const chunks = question ? await deps.retrieve(question, 5) : [];
    const system = buildSystemPrompt(chunks, deps.getConfig().custom_system_prompt);

    // Map UIMessages → plain model messages (avoids v7 convertToModelMessages quirks).
    const modelMessages: ModelMessage[] = messages
      .map((m) => ({ role: m.role, content: uiMessageText(m) }) as ModelMessage)
      .filter((m) => typeof m.content === "string" && m.content.length > 0);

    const result = streamText({
      model: deps.chatModel(),
      system,
      messages: modelMessages,
    });

    // Surface retrieved sources to the UI as message metadata.
    return result.toUIMessageStreamResponse({
      messageMetadata: () => ({ sources: extractSources(chunks) }),
    });
  });

  return app;
}
