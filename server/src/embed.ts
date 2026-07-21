// Embeddings via Ollama's HTTP API (POST /api/embed). Keeping embedding out-of-process
// in Ollama means the TS sidecar has no in-process ML native deps — it just does HTTP.
// Replaces backend/app/services/embedding_service.py (sentence-transformers).

export interface EmbedOptions {
  baseUrl: string; // e.g. http://localhost:11434
  model: string; // e.g. nomic-embed-text, bge-m3
}

/** Embed a batch of texts. Returns one vector per input, in order. */
export async function embed(texts: string[], opts: EmbedOptions): Promise<number[][]> {
  if (texts.length === 0) return [];
  const res = await fetch(`${opts.baseUrl}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: opts.model, input: texts }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { embeddings?: number[][] };
  if (!data.embeddings || data.embeddings.length !== texts.length) {
    throw new Error("Ollama embed returned an unexpected shape");
  }
  return data.embeddings;
}

/** Embed a single text. */
export async function embedOne(text: string, opts: EmbedOptions): Promise<number[]> {
  const [vector] = await embed([text], opts);
  if (!vector) throw new Error("Ollama returned no embedding");
  return vector;
}

/**
 * Ollama embedding model per configured language. Mirrors the intent of
 * embedding_service.py's language→model map, but using Ollama-hosted models.
 */
export function embeddingModelFor(language: "english" | "chinese" | "mixed"): string {
  switch (language) {
    case "chinese":
    case "mixed":
      return "bge-m3"; // multilingual, strong on Chinese
    case "english":
    default:
      return "nomic-embed-text";
  }
}
