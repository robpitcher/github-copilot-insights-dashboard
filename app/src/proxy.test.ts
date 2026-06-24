import { describe, it, expect } from "vitest";
import { isDeveloperForbidden } from "@/proxy";

describe("isDeveloperForbidden (org-wide / cross-user gating)", () => {
  it("allows a developer their own scoped usage (My Usage)", () => {
    expect(isDeveloperForbidden("/api/metrics/ai-credits")).toBe(false);
  });

  it("denies every other metrics report", () => {
    for (const path of [
      "/api/metrics/dashboard",
      "/api/metrics/code-generation",
      "/api/metrics/models",
      "/api/metrics/cli",
      "/api/metrics/agents",
      "/api/metrics/ai-adoption",
      "/api/metrics/seats",
      "/api/metrics/pull-requests",
      "/api/metrics/premium-requests",
    ]) {
      expect(isDeveloperForbidden(path)).toBe(true);
    }
  });

  it("denies other cross-user surfaces", () => {
    expect(isDeveloperForbidden("/api/users")).toBe(true);
    expect(isDeveloperForbidden("/api/filters")).toBe(true);
    expect(isDeveloperForbidden("/api/enterprise-teams")).toBe(true);
    expect(isDeveloperForbidden("/api/enterprise-teams/42/members")).toBe(true);
    expect(isDeveloperForbidden("/api/ai/insights")).toBe(true);
  });

  it("allows non-cross-user shared endpoints", () => {
    expect(isDeveloperForbidden("/api/data-range")).toBe(false);
    expect(isDeveloperForbidden("/api/health")).toBe(false);
    expect(isDeveloperForbidden("/api/auth/session")).toBe(false);
  });

  it("does not over-match similarly-named paths", () => {
    // Only `/api/users` and its children are denied, not an unrelated sibling.
    expect(isDeveloperForbidden("/api/users-export")).toBe(false);
    // The ai-credits allowance must not leak to a different report.
    expect(isDeveloperForbidden("/api/metrics/ai-credits-summary")).toBe(true);
  });
});
