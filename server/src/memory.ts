// Short-term memory assembly + watermark compression logic (Phase M, pure).
// Behavior parity reference: backend/app/services/memory_compression_service.py
// (watermark = last summarized message id; threshold<=0 disables compression).
import type { ModelMessage } from "ai";
import type { MessageRow } from "./sessions.ts";

export interface ChatContextInput {
  history: MessageRow[];
  /** Number of recent turns (user+assistant pairs) sent verbatim. 0 = none. */
  turns: number;
  /** Rolling summary of everything below the watermark. */
  summary?: string;
  /** Recalled semantic memories (already ranked). */
  memories?: string[];
}

export interface ChatContext {
  modelMessages: ModelMessage[];
  /** Extra system-prompt block: summary + recalled memories (empty when neither). */
  systemExtra: string;
}

export function buildChatContext({ history, turns, summary, memories }: ChatContextInput): ChatContext {
  const recent = turns > 0 ? history.slice(-turns * 2) : [];
  const modelMessages: ModelMessage[] = recent.map(
    (m) => ({ role: m.role, content: m.content }) as ModelMessage,
  );

  const blocks: string[] = [];
  if (summary) {
    blocks.push(`Summary of the earlier conversation:\n${summary}`);
  }
  if (memories && memories.length > 0) {
    blocks.push(`Relevant memories about the user (from past conversations):\n- ${memories.join("\n- ")}`);
  }
  return { modelMessages, systemExtra: blocks.join("\n\n") };
}

/** Python parity: compress only when strictly more than threshold; <=0 disables. */
export function needsCompression(unsummarizedCount: number, threshold: number): boolean {
  if (threshold <= 0) return false;
  return unsummarizedCount > threshold;
}

/** Messages above the watermark, excluding the recent verbatim window. */
export function sliceForCompression(
  history: MessageRow[],
  watermarkId: number,
  keepTurns: number,
): MessageRow[] {
  const keep = keepTurns > 0 ? keepTurns * 2 : 0;
  const cutoff = history.length - keep;
  return history.filter((m, i) => m.id > watermarkId && i < cutoff);
}

export interface Distillation {
  summary: string;
  facts: string[];
}

/** Parse the summarizer's combined output {summary, facts[]} — tolerant of
 * surrounding prose and malformed shapes (fail-open to empty, like parseRanking). */
export function parseDistillation(text: string): Distillation {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { summary: "", facts: [] };
  try {
    const obj = JSON.parse(match[0]) as { summary?: unknown; facts?: unknown };
    if (typeof obj.summary !== "string") return { summary: "", facts: [] };
    const rawFacts = Array.isArray(obj.facts) ? obj.facts : [];
    const facts = rawFacts.filter((f): f is string => typeof f === "string" && f.trim().length > 0);
    return { summary: obj.summary, facts };
  } catch {
    return { summary: "", facts: [] };
  }
}

/** Prompt for the combined compression+distillation call — one LLM pass produces
 * both the rolling summary and durable facts (distillation rides the compression
 * window, so it costs zero extra turns). */
export function buildDistillationPrompt(messages: MessageRow[], priorSummary?: string): string {
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");
  const prior = priorSummary ? `Earlier summary:\n${priorSummary}\n\n` : "";
  return (
    `${prior}Conversation segment:\n${transcript}\n\n` +
    "Produce JSON with exactly two keys:\n" +
    '{"summary": "concise summary of the segment merged with the earlier summary, keep key facts and decisions",\n' +
    ' "facts": ["durable facts about the user or their knowledge worth remembering across conversations"]}\n' +
    "facts must be short standalone statements; return an empty array if none. Respond with JSON only."
  );
}
