// The property that matters here is the OFF path: with no keys, tracing must be a
// transparent pass-through — same return value, same exceptions, no Langfuse import.
// These run with tracing off (no LANGFUSE_* keys in the test env), which is exactly
// the state a packaged app is permanently in.
import { expect, test } from "bun:test";
import { traced, tracingActive, withTraceAttributes } from "./tracing.ts";

test("tracing is inactive without keys", () => {
  expect(tracingActive()).toBe(false);
});

test("traced returns the function's value unchanged", () => {
  expect(traced("x", "span", () => 42)).toBe(42);
});

test("traced passes a working no-op recorder", () => {
  const value = traced("x", "retriever", (rec) => {
    rec.set({ input: { q: "hi" }, output: { hits: 3 } });
    return "ok";
  });
  expect(value).toBe("ok");
});

test("traced awaits and returns async results", async () => {
  await expect(traced("x", "chain", async () => "async-ok")).resolves.toBe("async-ok");
});

test("traced does not swallow errors from the wrapped function", () => {
  expect(() => traced("x", "span", () => {
    throw new Error("boom");
  })).toThrow("boom");
});

test("traced does not swallow async rejections", async () => {
  await expect(
    traced("x", "span", async () => {
      throw new Error("async-boom");
    }),
  ).rejects.toThrow("async-boom");
});

test("withTraceAttributes is a pass-through when inactive", () => {
  expect(withTraceAttributes({ sessionId: "s1" }, () => "value")).toBe("value");
});

test("withTraceAttributes propagates errors", () => {
  expect(() => withTraceAttributes({}, () => {
    throw new Error("nope");
  })).toThrow("nope");
});
