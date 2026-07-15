import { describe, expect, test } from "bun:test";
import {
  selectEvictions,
  buildChatContext,
  needsCompression,
  parseDistillation,
  sliceForCompression,
} from "./memory.ts";
import type { MessageRow } from "./sessions.ts";

const msg = (id: number, role: "user" | "assistant", content: string): MessageRow => ({
  id,
  role,
  content,
  sources: [],
  created_at: "2026-07-16",
});

describe("buildChatContext", () => {
  const history = [
    msg(1, "user", "q1"),
    msg(2, "assistant", "a1"),
    msg(3, "user", "q2"),
    msg(4, "assistant", "a2"),
    msg(5, "user", "q3"),
    msg(6, "assistant", "a3"),
  ];

  test("keeps only the last N turns verbatim", () => {
    const { modelMessages } = buildChatContext({ history, turns: 2 });
    // 2 turns = last 4 messages
    expect(modelMessages.map((m) => m.content)).toEqual(["q2", "a2", "q3", "a3"]);
  });

  test("turns=0 sends no history", () => {
    const { modelMessages } = buildChatContext({ history, turns: 0 });
    expect(modelMessages).toEqual([]);
  });

  test("summary and memories become a system context block", () => {
    const { systemExtra } = buildChatContext({
      history,
      turns: 1,
      summary: "早前讨论了区间DP",
      memories: ["用户在准备面试", "用户偏好中文回答"],
    });
    expect(systemExtra).toContain("早前讨论了区间DP");
    expect(systemExtra).toContain("用户在准备面试");
    expect(systemExtra).toContain("用户偏好中文回答");
    expect(systemExtra.indexOf("memor")).toBeGreaterThanOrEqual(0); // labelled sections
  });

  test("no summary and no memories yields empty systemExtra", () => {
    const { systemExtra } = buildChatContext({ history, turns: 1 });
    expect(systemExtra).toBe("");
  });
});

describe("needsCompression (python parity: threshold<=0 disables)", () => {
  test("true only when unsummarized count exceeds threshold", () => {
    expect(needsCompression(21, 20)).toBe(true);
    expect(needsCompression(20, 20)).toBe(false);
    expect(needsCompression(5, 20)).toBe(false);
  });
  test("disabled when threshold <= 0", () => {
    expect(needsCompression(100, 0)).toBe(false);
    expect(needsCompression(100, -1)).toBe(false);
  });
});

describe("sliceForCompression", () => {
  const history = Array.from({ length: 10 }, (_, i) =>
    msg(i + 1, i % 2 === 0 ? "user" : "assistant", `m${i + 1}`),
  );

  test("takes messages above the watermark but keeps the recent window out", () => {
    // watermark=2 (ids 1-2 already summarized), keepTurns=2 (last 4 messages stay)
    const slice = sliceForCompression(history, 2, 2);
    expect(slice.map((m) => m.id)).toEqual([3, 4, 5, 6]);
  });

  test("empty when everything above watermark fits in the window", () => {
    expect(sliceForCompression(history, 6, 2)).toEqual([]);
  });
});

describe("parseDistillation", () => {
  test("extracts summary and facts from a JSON response", () => {
    const out = parseDistillation(
      '这是结果：{"summary":"讨论了DP","facts":["用户在准备面试","用户主攻算法"]} 完毕',
    );
    expect(out.summary).toBe("讨论了DP");
    expect(out.facts).toEqual(["用户在准备面试", "用户主攻算法"]);
  });

  test("tolerates missing facts and garbage", () => {
    expect(parseDistillation('{"summary":"s"}')).toEqual({ summary: "s", facts: [], preferences: [] });
    expect(parseDistillation("not json at all")).toEqual({ summary: "", facts: [], preferences: [] });
    expect(parseDistillation('{"summary": 42, "facts": "x"}')).toEqual({ summary: "", facts: [], preferences: [] });
  });

  test("filters non-string and blank facts", () => {
    expect(parseDistillation('{"summary":"s","facts":["ok", "", 3, "  "]}').facts).toEqual(["ok"]);
  });
});

describe("parseDistillation preferences (M3)", () => {
  test("extracts preferences alongside facts", () => {
    const out = parseDistillation(
      '{"summary":"s","facts":["f1"],"preferences":["回答用中文","解释先给直觉"]}',
    );
    expect(out.preferences).toEqual(["回答用中文", "解释先给直觉"]);
  });
  test("missing preferences defaults to []", () => {
    expect(parseDistillation('{"summary":"s","facts":[]}').preferences).toEqual([]);
  });
});

describe("buildChatContext instructions (M3)", () => {
  test("standing instructions lead the system block", () => {
    const { systemExtra } = buildChatContext({
      history: [],
      turns: 0,
      summary: "sum",
      instructions: ["回答用中文"],
    });
    expect(systemExtra.indexOf("回答用中文")).toBeLessThan(systemExtra.indexOf("sum"));
    expect(systemExtra).toContain("Standing instructions");
  });
});

describe("selectEvictions (M3)", () => {
  const row = (id: number, kind: string, created: string, recalled?: string) => ({
    id,
    kind,
    created_at: created,
    last_recalled_at: recalled ?? null,
  })
  const policy = { maxSemantic: 2, episodicTtlDays: 90 }
  const now = new Date("2026-07-16T00:00:00Z")

  test("semantic over the cap evicts least-recently-recalled first", () => {
    const rows = [
      row(1, "semantic", "2026-01-01", "2026-07-01"), // recently recalled — keep
      row(2, "semantic", "2026-02-01"),               // never recalled, old — evict
      row(3, "semantic", "2026-06-01", "2026-03-01"), // stale recall — keep (cap=2)
    ]
    expect(selectEvictions(rows, policy, now)).toEqual([2])
  })

  test("episodic past TTL is evicted; fresh episodic stays", () => {
    const rows = [
      row(10, "episodic", "2026-01-01"), // >90d — evict
      row(11, "episodic", "2026-07-01"), // fresh — keep
    ]
    expect(selectEvictions(rows, policy, now)).toEqual([10])
  })

  test("procedural is never auto-evicted", () => {
    const rows = [row(20, "procedural", "2020-01-01")]
    expect(selectEvictions(rows, policy, now)).toEqual([])
  })

  test("under limits nothing is evicted", () => {
    const rows = [row(1, "semantic", "2026-01-01"), row(2, "episodic", "2026-07-10")]
    expect(selectEvictions(rows, policy, now)).toEqual([])
  })
})
