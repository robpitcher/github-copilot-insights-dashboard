import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql, is, getTableName } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";
import { logAudit, getClientIp } from "@/lib/audit";
import { requireAdminAuth, safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Tables that hold configuration / system state rather than ingested data.
 * These are preserved across a database reset (which only clears synced data).
 * Everything else defined in the schema is truncated, so newly added data
 * tables are cleared automatically without having to maintain a list by hand.
 */
const CONFIG_TABLES = new Set<string>([
  "app_settings", // GitHub token, enterprise slug, sync schedule
  "saved_views", // user-saved report views
  "alert_rules", // user-configured alerts
  "audit_log", // audit trail — must survive the reset that it records
]);

/**
 * All data tables to truncate, derived from the schema so it never drifts.
 * Computed once at module load from the static schema exports (not user input).
 */
const TABLES_TO_TRUNCATE: string[] = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableName(table as PgTable))
  .filter((name) => !CONFIG_TABLES.has(name));

/** Validate that a name is a safe SQL identifier (alphanumeric + underscores only). */
function isSafeIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name);
}

/** Explicit confirmation token the client must send to authorize a destructive reset. */
const RESET_CONFIRMATION = "RESET";

export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  // Require an explicit confirmation token in the body so a stray POST (or a
  // CSRF-style request) cannot wipe data. This is a deliberate second gate on
  // top of admin auth for an irreversible operation.
  let confirm: unknown;
  try {
    const body = await request.json();
    confirm = body?.confirm;
  } catch {
    confirm = undefined;
  }
  if (confirm !== RESET_CONFIRMATION) {
    return NextResponse.json(
      { error: `Reset not confirmed. Send { "confirm": "${RESET_CONFIRMATION}" } to proceed.` },
      { status: 400 },
    );
  }

  try {
    const truncated: string[] = [];
    const skipped: string[] = [];

    for (const table of TABLES_TO_TRUNCATE) {
      if (!isSafeIdentifier(table)) {
        skipped.push(table);
        continue;
      }
      try {
        await db.execute(sql`TRUNCATE TABLE ${sql.identifier(table)} CASCADE`);
        truncated.push(table);
      } catch {
        // Table may not exist yet
        skipped.push(table);
      }
    }

    console.info(`Database reset: truncated ${truncated.length} tables, skipped ${skipped.length}`);
    logAudit({
      action: "database_reset",
      category: "admin",
      details: { truncated, skipped },
      ipAddress: getClientIp(request),
    });

    return NextResponse.json({
      success: true,
      message: `Truncated ${truncated.length} tables`,
      truncated,
      skipped,
    });
  } catch (err) {
    console.error("Database reset failed:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to reset database") },
      { status: 500 },
    );
  }
}
