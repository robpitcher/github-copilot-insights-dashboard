import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  safeCompare,
  checkRateLimit,
  getLockoutRemainingMs,
  recordFailedAttempt,
  clearFailedAttempts,
  createIdentitySession,
  verifyIdentitySession,
  resolveRole,
  isIdentityModeEnabled,
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

describe("resolveRole", () => {
  const original = process.env.ADMIN_LOGINS;
  afterEach(() => {
    if (original === undefined) delete process.env.ADMIN_LOGINS;
    else process.env.ADMIN_LOGINS = original;
  });

  it("defaults to developer when ADMIN_LOGINS is unset", () => {
    delete process.env.ADMIN_LOGINS;
    expect(resolveRole("alice")).toBe("developer");
  });

  it("grants admin for an allowlisted login", () => {
    process.env.ADMIN_LOGINS = "alice,bob";
    expect(resolveRole("alice")).toBe("admin");
    expect(resolveRole("bob")).toBe("admin");
  });

  it("matches the allowlist case-insensitively", () => {
    process.env.ADMIN_LOGINS = "Alice,BOB";
    expect(resolveRole("alice")).toBe("admin");
    expect(resolveRole("BoB")).toBe("admin");
  });

  it("defaults to developer for a login not in the allowlist", () => {
    process.env.ADMIN_LOGINS = "alice,bob";
    expect(resolveRole("carol")).toBe("developer");
  });

  it("tolerates whitespace around allowlist entries", () => {
    process.env.ADMIN_LOGINS = " alice , bob ";
    expect(resolveRole("bob")).toBe("admin");
  });
});

describe("isIdentityModeEnabled", () => {
  const orig = {
    id: process.env.GITHUB_OAUTH_CLIENT_ID,
    secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
    session: process.env.SESSION_SECRET,
  };
  afterEach(() => {
    for (const [k, v] of [
      ["GITHUB_OAUTH_CLIENT_ID", orig.id],
      ["GITHUB_OAUTH_CLIENT_SECRET", orig.secret],
      ["SESSION_SECRET", orig.session],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("is disabled unless all identity env vars are set", () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.SESSION_SECRET;
    expect(isIdentityModeEnabled()).toBe(false);

    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    expect(isIdentityModeEnabled()).toBe(false);

    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    expect(isIdentityModeEnabled()).toBe(false);

    process.env.SESSION_SECRET = "signing-secret";
    expect(isIdentityModeEnabled()).toBe(true);
  });
});

describe("identity session mint/verify", () => {
  const original = process.env.SESSION_SECRET;
  beforeEach(() => {
    process.env.SESSION_SECRET = "test-session-secret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = original;
  });

  it("round-trips a valid session", () => {
    const token = createIdentitySession({ login: "alice", id: 42, role: "admin" });
    expect(token).not.toBe("");
    const session = verifyIdentitySession(token);
    expect(session).toEqual({ login: "alice", id: 42, role: "admin" });
  });

  it("returns null for a tampered payload", () => {
    const token = createIdentitySession({ login: "alice", id: 42, role: "developer" });
    const [, signature] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ login: "alice", id: 42, role: "admin", iat: Date.now() }),
    ).toString("base64url");
    expect(verifyIdentitySession(`${forged}.${signature}`)).toBeNull();
  });

  it("returns null for a tampered signature", () => {
    const token = createIdentitySession({ login: "alice", id: 42, role: "developer" });
    const [payload] = token.split(".");
    expect(verifyIdentitySession(`${payload}.deadbeef`)).toBeNull();
  });

  it("returns null for an expired session", () => {
    const token = createIdentitySession({ login: "alice", id: 42, role: "developer" });
    expect(verifyIdentitySession(token)).not.toBeNull();
    // Advance time beyond the 24h expiry window.
    const realNow = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(realNow + 25 * 60 * 60 * 1000);
    try {
      expect(verifyIdentitySession(token)).toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("returns null when SESSION_SECRET is unset", () => {
    const token = createIdentitySession({ login: "alice", id: 1, role: "developer" });
    delete process.env.SESSION_SECRET;
    expect(verifyIdentitySession(token)).toBeNull();
  });
});
