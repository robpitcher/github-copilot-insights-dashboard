import { NextRequest, NextResponse } from "next/server";
import { logAudit, getClientIp } from "@/lib/audit";
import {
  isIdentityModeEnabled,
  resolveRole,
  createIdentitySession,
  sessionCookieOptions,
  safeCompare,
  COOKIE_NAMES,
} from "@/lib/auth";

const COOKIE_OAUTH_STATE = "oauth_state";

/** Clear the transient OAuth state cookie on the given response. */
function clearStateCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_OAUTH_STATE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/**
 * GitHub OAuth callback. Validates the CSRF `state`, exchanges the `code` for an
 * access token, fetches the user's GitHub identity, resolves their role, and
 * mints a signed identity session cookie. Only available in identity mode.
 */
export async function GET(request: NextRequest) {
  if (!isIdentityModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const ip = getClientIp(request) ?? "unknown";

  try {
    const sp = request.nextUrl.searchParams;
    const code = sp.get("code");
    const state = sp.get("state");
    const oauthError = sp.get("error");
    const expectedState = request.cookies.get(COOKIE_OAUTH_STATE)?.value;

    // Validate the CSRF state on every callback, including error returns.
    if (!state || !expectedState || !safeCompare(state, expectedState)) {
      logAudit({ action: "identity_login_invalid_state", category: "auth", ipAddress: ip });
      const response = NextResponse.json(
        { error: "Invalid OAuth state" },
        { status: 400 },
      );
      clearStateCookie(response);
      return response;
    }

    // GitHub returned an error (e.g. the user denied consent) instead of a code.
    if (oauthError) {
      logAudit({
        action: "identity_login_denied",
        category: "auth",
        details: { error: oauthError },
        ipAddress: ip,
      });
      const response = NextResponse.json(
        { error: "GitHub authorization was denied or cancelled" },
        { status: 401 },
      );
      clearStateCookie(response);
      return response;
    }

    if (!code) {
      logAudit({ action: "identity_login_missing_code", category: "auth", ipAddress: ip });
      const response = NextResponse.json(
        { error: "Missing authorization code" },
        { status: 400 },
      );
      clearStateCookie(response);
      return response;
    }

    const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!;
    const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET!;
    const redirectUri = `${request.nextUrl.origin}/api/auth/github/callback`;

    // Exchange the authorization code for an access token.
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
        }),
      },
    );

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed with status ${tokenRes.status}`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      error?: string;
    };

    if (!tokenData.access_token) {
      logAudit({ action: "identity_login_token_error", category: "auth", ipAddress: ip });
      const response = NextResponse.json(
        { error: "OAuth authorization failed" },
        { status: 401 },
      );
      clearStateCookie(response);
      return response;
    }

    // Fetch the authenticated user's GitHub identity.
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: "Bearer " + tokenData.access_token,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
      },
    });

    if (!userRes.ok) {
      throw new Error(`User fetch failed with status ${userRes.status}`);
    }

    const user = (await userRes.json()) as { login?: string; id?: number };

    if (!user.login || typeof user.id !== "number") {
      throw new Error("GitHub user response missing login or id");
    }

    const role = resolveRole(user.login);
    const token = createIdentitySession({
      login: user.login,
      id: user.id,
      role,
    });

    logAudit({
      action: "identity_login_success",
      category: "auth",
      actor: user.login,
      details: { role },
      ipAddress: ip,
    });

    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(COOKIE_NAMES.identity, token, sessionCookieOptions());
    clearStateCookie(response);
    return response;
  } catch (err) {
    console.error("GitHub OAuth callback error:", err);
    logAudit({ action: "identity_login_error", category: "auth", ipAddress: ip });
    const response = NextResponse.json(
      { error: "Authentication failed" },
      { status: 500 },
    );
    clearStateCookie(response);
    return response;
  }
}
