import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  dimEnterpriseTeam,
  dimEnterpriseTeamMember,
  ingestionLog,
} from "@/lib/db/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Aggregate sync stats for enterprise teams: total team count, total
 * member count, and the timestamp of the most recent successful sync.
 * Used by the Data Sync page to surface sync status.
 */
export async function GET() {
  try {
    const [counts] = await db
      .select({
        teamCount: sql<number>`count(distinct ${dimEnterpriseTeam.teamId})`,
        memberCount: sql<number>`count(${dimEnterpriseTeamMember.id})`,
      })
      .from(dimEnterpriseTeam)
      .leftJoin(
        dimEnterpriseTeamMember,
        eq(dimEnterpriseTeam.teamId, dimEnterpriseTeamMember.teamId),
      );

    const [lastSync] = await db
      .select({
        completedAt: ingestionLog.completedAt,
        teamsSynced: ingestionLog.recordsFetched,
        membersSynced: ingestionLog.recordsInserted,
      })
      .from(ingestionLog)
      .where(
        and(
          eq(ingestionLog.scope, "enterprise_teams"),
          eq(ingestionLog.status, "success"),
        ),
      )
      .orderBy(desc(ingestionLog.completedAt))
      .limit(1);

    return NextResponse.json({
      teamCount: Number(counts?.teamCount ?? 0),
      memberCount: Number(counts?.memberCount ?? 0),
      lastSyncedAt: lastSync?.completedAt ?? null,
      lastSyncTeamsSynced: lastSync?.teamsSynced ?? null,
      lastSyncMembersSynced: lastSync?.membersSynced ?? null,
    });
  } catch (err) {
    console.error("Failed to fetch enterprise teams stats:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to fetch stats") },
      { status: 500 },
    );
  }
}
