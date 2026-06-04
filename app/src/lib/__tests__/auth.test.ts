import { describe, it, expect } from "vitest";
import {
  safeCompare,
  checkRateLimit,
  getLockoutRemainingMs,
  recordFailedAttempt,
  clearFailedAttempts,
} from "@/lib/auth";

describe("safeCompare", () => {
  it("returns true for identical strings", () => {
    expect(safeCompare("hunter2", "hunter2")).toBe(true);
  });

  it("returns false for different strings", () => {
    expect(safeCompare("hunter2", "hunter3")).toBe(false);
  });

  it("returns false for different-length strings", () => {
    expect(safeCompare("abc", "abcd")).toBe(false);
  });

  it("returns false for empty vs non-empty", () => {
    expect(safeCompare("", "x")).toBe(false);
  });
});

describe("checkRateLimit", () => {
  it("allows up to the limit then blocks within the window", () => {
    const key = `test-rl:${Math.random()}`;
    // RATE_LIMIT_MAX is 10 — first 10 allowed, 11th blocked.
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(key)).toBe(true);
    }
    expect(checkRateLimit(key)).toBe(false);
  });

  it("tracks keys independently", () => {
    const a = `test-rl-a:${Math.random()}`;
    const b = `test-rl-b:${Math.random()}`;
    for (let i = 0; i < 10; i++) checkRateLimit(a);
    expect(checkRateLimit(a)).toBe(false);
    expect(checkRateLimit(b)).toBe(true);
  });
});

describe("failed-attempt lockout", () => {
  it("does not lock out before the threshold", () => {
    const key = `test-lock:${Math.random()}`;
    for (let i = 0; i < 4; i++) {
      expect(recordFailedAttempt(key)).toBe(false);
    }
    expect(getLockoutRemainingMs(key)).toBe(0);
  });

  it("locks out on the 5th failure", () => {
    const key = `test-lock:${Math.random()}`;
    for (let i = 0; i < 4; i++) recordFailedAttempt(key);
    expect(recordFailedAttempt(key)).toBe(true);
    expect(getLockoutRemainingMs(key)).toBeGreaterThan(0);
  });

  it("clears the lockout on success", () => {
    const key = `test-lock:${Math.random()}`;
    for (let i = 0; i < 5; i++) recordFailedAttempt(key);
    expect(getLockoutRemainingMs(key)).toBeGreaterThan(0);
    clearFailedAttempts(key);
    expect(getLockoutRemainingMs(key)).toBe(0);
  });

  it("tracks lockout keys independently", () => {
    const a = `test-lock-a:${Math.random()}`;
    const b = `test-lock-b:${Math.random()}`;
    for (let i = 0; i < 5; i++) recordFailedAttempt(a);
    expect(getLockoutRemainingMs(a)).toBeGreaterThan(0);
    expect(getLockoutRemainingMs(b)).toBe(0);
  });
});
