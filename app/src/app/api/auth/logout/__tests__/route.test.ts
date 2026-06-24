import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Tests for `POST /api/auth/logout`. The route must clear every session cookie
 * (identity, admin, dashboard) regardless of auth mode and audit the event with
 * the signed-in login when one is present. The audit module is mocked so the
 * test never touches the database.
 */

vi.mock("@/lib/audit", () => ({
  logAudit: vi.fn(),
  getClientIp: vi.fn(() => undefined),
}));

import { logAudit } from "@/lib/audit";
import { createIdentitySession } from "@/lib/auth";
import { POST } from "@/app/api/auth/logout/route";

const SESSION_COOKIES = ["identity_session", "admin_session", "dashboard_session"];

function buildRequest(identityToken?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (identityToken) headers.cookie = `identity_session=${identityToken}`;
  return new NextRequest("https://example.test/api/auth/logout", {
    method: "POST",
    headers,
  });
}

describe("/api/auth/logout", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("returns success and expires every session cookie", async () => {
    const res = await POST(buildRequest());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    for (const name of SESSION_COOKIES) {
      const cookie = res.cookies.get(name);
      expect(cookie?.value).toBe("");
      expect(cookie?.maxAge).toBe(0);
    }
  });

  it("audits the logout with the signed-in login as actor", async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    process.env.SESSION_SECRET = "test-session-secret";
    const token = createIdentitySession({ login: "alice", id: 1, role: "developer" });

    await POST(buildRequest(token));

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "logout", category: "auth", actor: "alice" }),
    );
  });

  it("audits the logout with no actor when not signed in", async () => {
    delete process.env.GITHUB_OAUTH_CLIENT_ID;
    delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
    delete process.env.SESSION_SECRET;

    await POST(buildRequest());

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "logout", actor: undefined }),
    );
  });
});
