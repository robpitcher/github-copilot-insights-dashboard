import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { getSetting } from "@/lib/db/settings";
import { safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Check database connectivity
    let dbStatus = "disconnected";
    let dbHost = "unknown";
    let dbName = "unknown";
    try {
      const result = await db.execute(sql`SELECT 1 as ok`);
      if (result.length) dbStatus = "connected";
      // Get DB host/name from connection string (mask sensitive parts)
      const connStr = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
      if (connStr) {
        try {
          const url = new URL(connStr);
          dbHost = url.hostname;
          dbName = url.pathname.replace("/", "") || "unknown";
        } catch {
          dbHost = "configured";
          dbName = "configured";
        }
      }
    } catch {
      dbStatus = "disconnected";
    }

    const enterpriseSlug = await getSetting("github_enterprise_slug");
    const syncScope = await getSetting("sync_scope") ?? "enterprise";

    return NextResponse.json({
      database: {
        status: dbStatus,
        host: dbHost,
        name: dbName,
      },
      enterprise: {
        slug: enterpriseSlug ?? null,
        syncScope,
      },
      api: {
        version: "2026-03-10",
      },
      app: {
        version: process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0",
        buildId: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev",
        buildTime: process.env.NEXT_PUBLIC_BUILD_TIME ?? null,
      },
      requiredScopes: [
        { scope: "manage_billing:copilot (read)", description: "Copilot usage metrics" },
        { scope: "read:org", description: "Organization and team membership" },
        { scope: "read:enterprise", description: "Enterprise team listing" },
        { scope: "manage_billing:enterprise (read)", description: "Enterprise billing data" },
      ],
    });
  } catch (err) {
    console.error("App info API error:", err);
    return NextResponse.json({ error: safeErrorMessage(err, "Failed to fetch app info") }, { status: 500 });
  }
}
