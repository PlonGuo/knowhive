// Shared data contracts between the TS frontend (Vite/React) and the bun sidecar.
// Ported from backend/app/config.py (AppConfig) — keep field names/defaults in sync.
import { z } from "zod";

export const LLMProvider = z.enum(["ollama", "openai-compatible", "anthropic"]);
export type LLMProvider = z.infer<typeof LLMProvider>;

export const EmbeddingLanguage = z.enum(["english", "chinese", "mixed"]);
export type EmbeddingLanguage = z.infer<typeof EmbeddingLanguage>;

export const PreRetrievalStrategy = z.enum([
  "none",
  "hyde",
  "multi_query",
  "auto",
  "auto_llm",
]);
export type PreRetrievalStrategy = z.infer<typeof PreRetrievalStrategy>;

export const RerankerBackend = z.enum(["llm", "cross-encoder"]);
export type RerankerBackend = z.infer<typeof RerankerBackend>;

export const ChatMode = z.enum(["single", "agentic"]);
export type ChatMode = z.infer<typeof ChatMode>;

/** Mirrors backend/app/config.py:AppConfig (field names + defaults). */
export const AppConfigSchema = z.object({
  llm_provider: LLMProvider.default("ollama"),
  model_name: z.string().default("llama3.2"),
  base_url: z.string().default("http://localhost:11434"),
  api_key: z.string().nullable().default(null),
  embedding_language: EmbeddingLanguage.default("english"),
  first_run_complete: z.boolean().default(false),
  pre_retrieval_strategy: PreRetrievalStrategy.default("none"),
  use_reranker: z.boolean().default(false),
  // "cross-encoder" = in-process ONNX (Phase E2, default: won the RAGAS gate on all
  // four metrics); "llm" = LLM-as-reranker (Phase E1, kept as fallback backend)
  reranker_backend: RerankerBackend.default("cross-encoder"),
  // "single" = one-shot RAG; "agentic" = tool-use loop (Phase G). Default flips
  // only after the Task 7 eval gate passes.
  chat_mode: ChatMode.default("single"),
  chat_memory_turns: z.number().int().default(0),
  memory_compression_threshold: z.number().int().default(20),
  custom_system_prompt: z.string().default(""),
});
export type AppConfig = z.infer<typeof AppConfigSchema>;
