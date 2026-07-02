// Ollama model management for onboarding/settings (R3): which models the current
// config needs, and whether they're installed locally.
import type { AppConfig } from "../../shared/schema.ts";
import { embeddingModelFor } from "./embed.ts";

export interface RequiredModel {
  name: string;
  purpose: "chat" | "embedding";
}

export interface OllamaStatus {
  running: boolean;
  models: string[];
  required: (RequiredModel & { installed: boolean })[];
}

/** Models the current config needs from the local Ollama. Embeddings always run on
 * Ollama in the TS stack, so the embedding model is required even for cloud chat providers. */
export function requiredModels(config: AppConfig): RequiredModel[] {
  const models: RequiredModel[] = [];
  if (config.llm_provider === "ollama") {
    models.push({ name: config.model_name, purpose: "chat" });
  }
  models.push({ name: embeddingModelFor(config.embedding_language), purpose: "embedding" });
  return models;
}

export function buildOllamaStatus(installedModels: string[], config: AppConfig): OllamaStatus {
  // Tag names from /api/tags carry a ":latest"-style suffix; a bare required name
  // matches any tag of that model, an explicit "name:tag" only matches exactly.
  const isInstalled = (name: string) =>
    installedModels.some((m) => m === name || (!name.includes(":") && m.startsWith(`${name}:`)));

  return {
    running: true,
    models: installedModels,
    required: requiredModels(config).map((r) => ({ ...r, installed: isInstalled(r.name) })),
  };
}
