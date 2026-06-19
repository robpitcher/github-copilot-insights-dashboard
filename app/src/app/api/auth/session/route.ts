import { NextRequest, NextResponse } from "next/server";
import {
  isIdentityModeEnabled,
  getIdentitySessionFromRequest,
  safeErrorMessage,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Expose the current identity session to client components so the UI can gate
 * navigation by role. Only meaningful in identity mode (GitHub OAuth); in open
 * and shared-password modes `identityMode` is false and the client keeps its
 * existing behavior. This endpoint never returns secrets — only the signed-in
 * login and resolved role. Server-side row-level scoping is enforced
 * independently in each data route (see `resolveUserScope`).
 */
export async function GET(request: NextRequest) {
  try {
    const identityMode = isIdentityModeEnabled();
    const session = identityMode ? getIdentitySessionFromRequest(request) : null;

    return NextResponse.json({
      identityMode,
      authenticated: !!session,
      login: session?.login ?? null,
      role: session?.role ?? null,
    });
  } catch (error) {
    console.error("Failed to resolve identity session:", error);
    return NextResponse.json(
      { error: safeErrorMessage(error, "Internal server error") },
      { status: 500 },
    );
  }
}
