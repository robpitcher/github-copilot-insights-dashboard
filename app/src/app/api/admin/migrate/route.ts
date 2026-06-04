import { NextRequest, NextResponse } from "next/server";
import { logAudit, getClientIp } from "@/lib/audit";
import { requireAdminAuth, safeErrorMessage } from "@/lib/auth";
import { runMigrations, listMigrationStatus } from "@/lib/db/migrate";

export const dynamic = "force-dynamic";

/**
 * List all migrations and their applied/pending status, plus a schema-drift
 * summary. Admin-gated, read-only.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const status = await listMigrationStatus();
    return NextResponse.json(status);
  } catch (err) {
    console.error("Failed to list migrations:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to list migrations") },
      { status: 500 },
    );
  }
}

/**
 * Run pending database migrations plus idempotent schema fixups on demand.
 * Admin-gated. Safe to run repeatedly — every statement uses IF NOT EXISTS.
 */
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const result = await runMigrations();

    console.info(`Manual migration run: success=${result.success}`);
    logAudit({
      action: "migrations_run",
      category: "admin",
      details: {
        success: result.success,
        migrationError: result.migrationError ?? null,
        fixupError: result.fixupError ?? null,
      },
      ipAddress: getClientIp(request),
    });

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.migrationError ?? result.fixupError ?? "Migration failed",
          logs: result.logs,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Migrations applied successfully",
      logs: result.logs,
    });
  } catch (err) {
    console.error("Manual migration run failed:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to run migrations") },
      { status: 500 },
    );
  }
}
