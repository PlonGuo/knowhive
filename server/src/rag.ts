// RAG prompt assembly. Ported from backend/app/services/rag_service.py
// (SYSTEM_PROMPT, build_prompt, extract_sources). Context is injected into the system
// message; conversation messages pass through unchanged (works cleanly for multi-turn).
import type { ChunkRow } from "./store.ts";

export const SYSTEM_PROMPT =
  "You are a helpful AI assistant for a personal knowledge base. " +
  "Answer the user's question based on the provided context from their documents. " +
  "If the context doesn't contain relevant information, say so honestly. " +
  "Cite the source file paths when referencing specific information.";

/** Build the system prompt: base (+ custom) + retrieved context block. */
export function buildSystemPrompt(chunks: readonly ChunkRow[], customSystemPrompt = ""): string {
  let system = SYSTEM_PROMPT;
  if (customSystemPrompt) system += `\n\n${customSystemPrompt}`;

  if (chunks.length > 0) {
    const context = chunks.map((c) => `[Source: ${c.file_path}]\n${c.content}`).join("\n\n");
    system += `\n\nContext from knowledge base:\n\n${context}`;
  } else {
    system += `\n\nNo relevant context was found in the knowledge base.`;
  }
  return system;
}

// Tool guidance for the agentic loop. Deliberately short: 3B-class models lose
// instruction-following on long prompts (see learnings/Llama32-Tool-Call-Spike.md).
const AGENT_TOOL_GUIDANCE =
  "You have tools to explore the knowledge base:\n" +
  "- search_knowledge: search for notes on a topic. Use it when the context below is not enough, " +
  "or the question spans multiple topics (compare/aggregate) — search each missing topic once.\n" +
  "- read_note: read one full note when an excerpt is cut off.\n" +
  "- list_notes: list all note paths.\n" +
  "Do not repeat a search you already made. When you have enough information, answer directly.";

/** System prompt for the agentic loop: base (+ custom) + tool guidance + pre-retrieved context. */
export function buildAgentSystemPrompt(
  chunks: readonly ChunkRow[],
  customSystemPrompt = "",
): string {
  let system = SYSTEM_PROMPT;
  if (customSystemPrompt) system += `\n\n${customSystemPrompt}`;
  system += `\n\n${AGENT_TOOL_GUIDANCE}`;

  if (chunks.length > 0) {
    const context = chunks.map((c) => `[Source: ${c.file_path}]\n${c.content}`).join("\n\n");
    system += `\n\nContext from knowledge base:\n\n${context}`;
  } else {
    system += `\n\nNo relevant context was found in the knowledge base for the question yet.`;
  }
  return system;
}

/** Unique source file paths from chunks, preserving first-seen order. */
export function extractSources(chunks: readonly ChunkRow[]): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const c of chunks) {
    if (!seen.has(c.file_path)) {
      seen.add(c.file_path);
      sources.push(c.file_path);
    }
  }
  return sources;
}

/** Extract plain text from a Vercel AI SDK UIMessage (v7 uses a `parts` array). */
export function uiMessageText(msg: { content?: unknown; parts?: unknown[] } | undefined): string {
  if (!msg) return "";
  if (typeof msg.content === "string") return msg.content;
  const parts = Array.isArray(msg.parts) ? msg.parts : [];
  return parts
    .filter((p): p is { type: string; text: string } => {
      const o = p as { type?: unknown; text?: unknown };
      return o.type === "text" && typeof o.text === "string";
    })
    .map((p) => p.text)
    .join(" ")
    .trim();
}
