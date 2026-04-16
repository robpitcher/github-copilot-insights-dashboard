import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dimUser, dimOrg, dimEnterpriseTeam, dimEnterpriseTeamMember } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { getGitHubConfig } from "@/lib/db/settings";
import { resolveDisplayNames, formatUserLabel } from "@/lib/github/resolve-display-names";
import { safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [users, teams, orgs, enterpriseTeams] = await Promise.all([
      // Distinct users from dimUser (current only)
      db
        .select({
          userId: dimUser.userId,
          userLogin: dimUser.userLogin,
        })
        .from(dimUser)
        .where(eq(dimUser.isCurrent, true))
        .orderBy(dimUser.userLogin),

      // Distinct team names from dimUser (non-null)
      db
        .selectDistinct({
          teamName: dimUser.teamName,
        })
        .from(dimUser)
        .where(sql`${dimUser.teamName} IS NOT NULL AND ${dimUser.isCurrent} = true`)
        .orderBy(dimUser.teamName),

      // All orgs
      db
        .select({
          orgId: dimOrg.orgId,
          orgName: dimOrg.orgName,
        })
        .from(dimOrg)
        .orderBy(dimOrg.orgName),

      // Enterprise teams with member count
      db
        .select({
          teamId: dimEnterpriseTeam.teamId,
          teamName: dimEnterpriseTeam.teamName,
          teamSlug: dimEnterpriseTeam.teamSlug,
          memberCount: sql<number>`count(${dimEnterpriseTeamMember.id})`.as("member_count"),
        })
        .from(dimEnterpriseTeam)
        .leftJoin(
          dimEnterpriseTeamMember,
          eq(dimEnterpriseTeam.teamId, dimEnterpriseTeamMember.teamId),
        )
        .groupBy(
          dimEnterpriseTeam.teamId,
          dimEnterpriseTeam.teamName,
          dimEnterpriseTeam.teamSlug,
        )
        .orderBy(dimEnterpriseTeam.teamName),
    ]);

    // Resolve display names for users
    const logins = users.map((u) => u.userLogin);
    const { token } = await getGitHubConfig();
    const displayNameMap = token
      ? await resolveDisplayNames(logins, token)
      : new Map<string, string>();

    return NextResponse.json({
      users: users.map((u) => ({
        id: u.userId,
        login: u.userLogin,
        displayLabel: formatUserLabel(u.userLogin, displayNameMap),
      })),
      teams: teams.filter((t) => t.teamName).map((t) => t.teamName),
      orgs: orgs.map((o) => ({ id: o.orgId, name: o.orgName })),
      enterpriseTeams: enterpriseTeams.map((t) => ({
        id: t.teamId,
        name: t.teamName,
        slug: t.teamSlug,
        memberCount: Number(t.memberCount),
      })),
    });
  } catch (err) {
    console.error("Filters API error:", err);
    return NextResponse.json({ error: safeErrorMessage(err, "Internal server error") }, { status: 500 });
  }
}
