import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createIdentitySession } from "@/lib/auth";
import { GET } from "@/app/api/auth/session/route";

/**
 * Tests for `/api/auth/session`, the client-facing endpoint the sidebar uses to
 * gate navigation by role. It must never leak secrets and must reflect the
 * active auth mode + the signed-in user's role.
 */

function buildRequest(identityToken?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (identityToken) headers.cookie = `identity_session=${identityToken}`;
  return new NextRequest("https://example.test/api/auth/session", { headers });
}

describe("/api/auth/session", () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  describe("when identity mode is disabled", () => {
    beforeEach(() => {
      delete process.env.GITHUB_OAUTH_CLIENT_ID;
      delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
      delete process.env.SESSION_SECRET;
    });

    it("reports identityMode false and no session", async () => {
      const res = await GET(buildRequest());
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        identityMode: false,
        authenticated: false,
        login: null,
        role: null,
      });
    });
  });

  describe("when identity mode is enabled", () => {
    beforeEach(() => {
      process.env.GITHUB_OAUTH_CLIENT_ID = "id";
      process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
      process.env.SESSION_SECRET = "test-session-secret";
    });

    it("returns the developer role for a signed-in developer", async () => {
      const token = createIdentitySession({ login: "alice", id: 1, role: "developer" });
      const res = await GET(buildRequest(token));
      const body = await res.json();
      expect(body).toEqual({
        identityMode: true,
        authenticated: true,
        login: "alice",
        role: "developer",
      });
    });

    it("returns the admin role for a signed-in admin", async () => {
      const token = createIdentitySession({ login: "boss", id: 9, role: "admin" });
      const res = await GET(buildRequest(token));
      const body = await res.json();
      expect(body.role).toBe("admin");
      expect(body.login).toBe("boss");
    });

    it("reports unauthenticated when no cookie is present", async () => {
      const res = await GET(buildRequest());
      const body = await res.json();
      expect(body).toEqual({
        identityMode: true,
        authenticated: false,
        login: null,
        role: null,
      });
    });
  });
});
