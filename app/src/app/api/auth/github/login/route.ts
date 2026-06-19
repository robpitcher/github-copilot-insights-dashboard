import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { isIdentityModeEnabled } from "@/lib/auth";

const COOKIE_OAUTH_STATE = "oauth_state";
const STATE_MAX_AGE_S = 600; // 10 minutes

/**
 * Begin the GitHub OAuth web flow. Redirects the browser to GitHub's
 * authorization screen with a CSRF `state` value stored in a short-lived cookie.
 * Only available in identity mode (GitHub OAuth env vars configured).
 */
export async function GET(request: NextRequest) {
  if (!isIdentityModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const clientId = process.env.GITHUB_OAUTH_CLIENT_ID!;
  const redirectUri = `${request.nextUrl.origin}/api/auth/github/callback`;
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl.toString());
  response.cookies.set(COOKIE_OAUTH_STATE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: STATE_MAX_AGE_S,
  });
  return response;
}
