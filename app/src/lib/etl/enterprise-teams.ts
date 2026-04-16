/**
 * ETL for Enterprise Teams + Team Memberships.
 *
 * Syncs the list of enterprise teams and each team's members from the
 * GitHub Enterprise Teams REST API into the `dim_enterprise_team` and
 * `dim_enterprise_team_member` tables. Each sync run is recorded in
 * `ingestion_log` with `scope='enterprise_teams'` so it shows up in
 * the unified sync history.
 */

import { db } from "@/lib/db";
import {
  dimEnterpriseTeam,
  dimEnterpriseTeamMember,
  ingestionLog,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  listEnterpriseTeams,
  listEnterpriseTeamMembers,
} from "@/lib/github/copilot-api";
import { adminErrorMessage } from "@/lib/auth";

export interface SyncEnterpriseTeamsOptions {
  enterpriseSlug: string;
  token: string;
  /** Source of the ingestion: "api" (manual), "scheduled". */
  source?: "api" | "scheduled";
  onLog?: (message: string) => void;
}

export interface SyncEnterpriseTeamsResult {
  teamsSynced: number;
  totalMembers: number;
  apiRequests: number;
  ingestionLogId: number;
}

/**
 * Sync enterprise teams + memberships. Writes an `ingestion_log` row
 * (scope='enterprise_teams') so the run appears in sync history.
 */
export async function syncEnterpriseTeams(
  opts: SyncEnterpriseTeamsOptions,
): Promise<SyncEnterpriseTeamsResult> {
  const log = opts.onLog ?? (() => {});
  const messages: string[] = [];
  const send = (msg: string) => {
    messages.push(msg);
    log(msg);
  };

  const today = new Date().toISOString().slice(0, 10);

  const [logEntry] = await db
    .insert(ingestionLog)
    .values({
      ingestionDate: today,
      source: opts.source ?? "api",
      scope: "enterprise_teams",
      scopeDetail: `Enterprise: ${opts.enterpriseSlug}`,
      status: "running",
    })
    .returning();

  send(`Enterprise teams sync started (log #${logEntry.id})`);

  let apiRequests = 0;
  let totalMembers = 0;

  try {
    // 1) List all teams
    const { teams, apiRequestCount: teamsReq } = await listEnterpriseTeams({
      enterpriseSlug: opts.enterpriseSlug,
      token: opts.token,
      onLog: send,
    });
    apiRequests += teamsReq;

    send(`Found ${teams.length} team(s). Upserting and fetching members…`);

    // 2) For each team: upsert, then replace members
    for (const team of teams) {
      const [upserted] = await db
        .insert(dimEnterpriseTeam)
        .values({
          githubTeamId: team.id,
          teamName: team.name,
          teamSlug: team.slug,
          description: team.description ?? null,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: dimEnterpriseTeam.githubTeamId,
          set: {
            teamName: team.name,
            teamSlug: team.slug,
            description: team.description ?? null,
            updatedAt: new Date(),
          },
        })
        .returning({ teamId: dimEnterpriseTeam.teamId });

      const teamId = upserted.teamId;

      const { members, apiRequestCount: memReq } =
        await listEnterpriseTeamMembers({
          enterpriseSlug: opts.enterpriseSlug,
          teamSlug: team.slug,
          teamId: team.id,
          token: opts.token,
          onLog: send,
        });
      apiRequests += memReq;

      // Full sync: delete existing members, then re-insert
      await db
        .delete(dimEnterpriseTeamMember)
        .where(eq(dimEnterpriseTeamMember.teamId, teamId));

      if (members.length > 0) {
        await db.insert(dimEnterpriseTeamMember).values(
          members.map((m) => ({
            teamId,
            userId: m.id,
            userLogin: m.login,
            role: "member",
          })),
        );
      }

      totalMembers += members.length;
    }

    send(
      `Sync complete: ${teams.length} team(s), ${totalMembers} member(s), ${apiRequests} API request(s)`,
    );

    await db
      .update(ingestionLog)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsFetched: teams.length,
        recordsInserted: totalMembers,
        apiRequests,
        logMessages: messages.join("\n"),
      })
      .where(eq(ingestionLog.id, logEntry.id));

    return {
      teamsSynced: teams.length,
      totalMembers,
      apiRequests,
      ingestionLogId: logEntry.id,
    };
  } catch (err) {
    const message = adminErrorMessage(err, "Enterprise teams sync failed");
    send(`ERROR: ${message}`);
    console.error("Enterprise teams sync failed:", err);

    await db
      .update(ingestionLog)
      .set({
        status: "error",
        completedAt: new Date(),
        errorMessage: message,
        apiRequests,
        logMessages: messages.join("\n"),
      })
      .where(eq(ingestionLog.id, logEntry.id));

    throw err;
  }
}
