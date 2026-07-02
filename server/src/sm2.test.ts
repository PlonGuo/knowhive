import { test, expect } from "bun:test";
import { applySm2, roundHalfToEven, type ReviewItem } from "./sm2.ts";

// Parity tests against backend/app/services/spaced_repetition_service.py:apply_sm2
// (SM-2 algorithm; quality grades 0=blackout … 4=easy).

const item = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 1,
  file_path: "note.md",
  question: "Q",
  answer: "A",
  repetitions: 0,
  easiness: 2.5,
  interval: 1,
  due_date: "2026-07-01",
  ...over,
});

const TODAY = "2026-07-02";

test("failed recall (q<2) resets repetitions and interval", () => {
  const updated = applySm2(item({ repetitions: 5, interval: 30 }), 0, TODAY);
  expect(updated.repetitions).toBe(0);
  expect(updated.interval).toBe(1);
  expect(updated.due_date).toBe("2026-07-03");
});

test("easiness update follows EF' = EF + (0.1 - (5-q)*(0.08+(5-q)*0.02))", () => {
  // q=4: EF' = 2.5 + (0.1 - 1*(0.08+1*0.02)) = 2.5
  expect(applySm2(item(), 4, TODAY).easiness).toBeCloseTo(2.5, 10);
  // q=3: EF' = 2.5 + (0.1 - 2*(0.08+2*0.02)) = 2.36
  expect(applySm2(item(), 3, TODAY).easiness).toBeCloseTo(2.36, 10);
  // q=0: EF' = 2.5 + (0.1 - 5*(0.08+5*0.02)) = 1.7
  expect(applySm2(item(), 0, TODAY).easiness).toBeCloseTo(1.7, 10);
});

test("easiness never drops below 1.3", () => {
  const updated = applySm2(item({ easiness: 1.3 }), 0, TODAY);
  expect(updated.easiness).toBe(1.3);
});

test("first successful repetition gets a 1-day interval", () => {
  const updated = applySm2(item({ repetitions: 0 }), 3, TODAY);
  expect(updated.repetitions).toBe(1);
  expect(updated.interval).toBe(1);
  expect(updated.due_date).toBe("2026-07-03");
});

test("second successful repetition gets a 6-day interval", () => {
  const updated = applySm2(item({ repetitions: 1 }), 3, TODAY);
  expect(updated.repetitions).toBe(2);
  expect(updated.interval).toBe(6);
  expect(updated.due_date).toBe("2026-07-08");
});

test("later repetitions scale the interval by the new easiness", () => {
  // reps 2→3, EF' = 2.36, interval = round(6 * 2.36) = round(14.16) = 14
  const updated = applySm2(item({ repetitions: 2, interval: 6, easiness: 2.5 }), 3, TODAY);
  expect(updated.repetitions).toBe(3);
  expect(updated.interval).toBe(14);
  expect(updated.due_date).toBe("2026-07-16");
});

test("interval rounding is half-to-even (python round parity)", () => {
  expect(roundHalfToEven(12.5)).toBe(12);
  expect(roundHalfToEven(13.5)).toBe(14);
  expect(roundHalfToEven(14.16)).toBe(14);
  expect(roundHalfToEven(2.5)).toBe(2);
  expect(roundHalfToEven(3.0)).toBe(3);
});

test("due date crosses month boundaries correctly", () => {
  const updated = applySm2(item({ repetitions: 1 }), 4, "2026-07-30");
  expect(updated.interval).toBe(6);
  expect(updated.due_date).toBe("2026-08-05");
});
