import { test, expect } from "bun:test";
import { openDbAt } from "./db.ts";
import { ingestText } from "./ingest.ts";
import { hybridSearch } from "./store.ts";

// Deterministic fake embedder: a 3-dim topic vector [cat, dog, transformer].
// Lets us assert retrieval behavior without depending on Ollama.
const fakeEmbed = (texts: string[]): Promise<number[][]> =>
  Promise.resolve(
    texts.map((t) => {
      const s = t.toLowerCase();
      return [
        s.includes("cat") ? 1 : 0,
        s.includes("dog") ? 1 : 0,
        s.includes("transformer") || s.includes("attention") ? 1 : 0,
      ];
    }),
  );

// Each section is >100 chars so the short-section merge doesn't collapse them.
const DOC = [
  "# Cats",
  "Cats are small domesticated carnivorous mammals that are often kept as pets by humans in households all around the world today.",
  "# Dogs",
  "Dogs are loyal domesticated animals that are commonly kept as companions and working partners by people across many cultures.",
  "# Transformers",
  "Transformers use self attention mechanisms to process token sequences in modern deep learning architectures for language tasks.",
].join("\n");

test("ingestText stores one chunk per section and reports the count", async () => {
  const db = openDbAt(":memory:");
  const res = await ingestText(db, "animals.md", DOC, fakeEmbed);
  expect(res.chunkCount).toBe(3);
  const row = db.query("SELECT COUNT(*) AS c FROM chunks").get() as { c: number };
  expect(row.c).toBe(3);
  db.close();
});

test("hybrid search retrieves the semantically matching chunk", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  const [qvec] = await fakeEmbed(["tell me about cats"]);
  const hits = hybridSearch(db, qvec!, "cats", 2);
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]!.content.toLowerCase()).toContain("cat");
  db.close();
});

test("re-ingest of the same file is idempotent (no duplicate chunks)", async () => {
  const db = openDbAt(":memory:");
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  await ingestText(db, "animals.md", DOC, fakeEmbed);
  const row = db.query("SELECT COUNT(*) AS c FROM chunks").get() as { c: number };
  expect(row.c).toBe(3);
  db.close();
});
