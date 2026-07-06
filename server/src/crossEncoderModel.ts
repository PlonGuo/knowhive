// Real transformers.js cross-encoder scorer (Phase E2). Lazy singleton: the first
// rerank (or POST /reranker/download) pays the download+load cost, everything after
// scores in ~10-20ms/pair (spike-verified in bun; int8 ONNX, 571MB).
// Not unit-tested — the pure sorting logic lives in crossEncoder.ts; this module is
// validated by the Task 5 RAGAS run.
import { AutoTokenizer, AutoModelForSequenceClassification } from "@huggingface/transformers";
import type { CrossEncoderScorer } from "./crossEncoder.ts";

const MODEL = "onnx-community/bge-reranker-v2-m3-ONNX";
// int8 chosen pending the Task 5 quality gate; fp16 (1.14GB) is the fallback.
const DTYPE = "int8";

let loaded: Promise<{
  tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>>;
  model: Awaited<ReturnType<typeof AutoModelForSequenceClassification.from_pretrained>>;
}> | null = null;

function load() {
  if (!loaded) {
    loaded = (async () => {
      const t0 = performance.now();
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL);
      const model = await AutoModelForSequenceClassification.from_pretrained(MODEL, {
        dtype: DTYPE,
      });
      console.log(`[crossEncoder] ${MODEL} (${DTYPE}) loaded in ${(performance.now() - t0).toFixed(0)}ms`);
      return { tokenizer, model };
    })();
  }
  return loaded;
}

export const crossEncoderScore: CrossEncoderScorer = async (query, passages) => {
  const { tokenizer, model } = await load();
  const scores: number[] = [];
  for (const passage of passages) {
    const inputs = tokenizer(query, { text_pair: passage, padding: true, truncation: true });
    const { logits } = await model(inputs);
    scores.push(logits.data[0] as number);
  }
  return scores;
};

export function isCrossEncoderLoaded(): boolean {
  return loaded !== null;
}
