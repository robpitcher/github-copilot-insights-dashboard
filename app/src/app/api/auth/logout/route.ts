import { NextRequest, NextResponse } from "next/server";
import { logAudit, getClientIp } from "@/lib/audit";
import {
  COOKIE_NAMES,
  sessionCookieOptions,
  getIdentitySessionFromRequest,
  safeErrorMessage,
} from "@/lib/auth";

/**
 * Sign the user out by clearing every session cookie (identity, admin and
 * dashboard). Lives under `/api/auth/` so it is reachable without an existing
 * valid session — the proxy treats `/api/auth/*` as public. Clearing a cookie
 * that was never set is a harmless no-op, so this works in every auth mode.
 */
export async function POST(request: NextRequest) {
  try {
    const session = getIdentitySessionFromRequest(request);
    const response = NextResponse.json({ success: true });

    // Expire each session cookie using the same attributes it was set with.
    const cleared = { ...sessionCookieOptions(), maxAge: 0 };
    response.cookies.set(COOKIE_NAMES.identity, "", cleared);
    response.cookies.set(COOKIE_NAMES.admin, "", cleared);
    response.cookies.set(COOKIE_NAMES.dashboard, "", cleared);

    logAudit({
      action: "logout",
      category: "auth",
      actor: session?.login,
      ipAddress: getClientIp(request) ?? "unknown",
    });

    return response;
  } catch (err) {
    console.error("Logout error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Logout failed") },
      { status: 500 },
    );
  }
}
