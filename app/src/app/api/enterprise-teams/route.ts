import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dimEnterpriseTeam, dimEnterpriseTeamMember } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const teams = await db
      .select({
        teamId: dimEnterpriseTeam.teamId,
        githubTeamId: dimEnterpriseTeam.githubTeamId,
        teamName: dimEnterpriseTeam.teamName,
        teamSlug: dimEnterpriseTeam.teamSlug,
        description: dimEnterpriseTeam.description,
        memberCount: sql<number>`count(${dimEnterpriseTeamMember.id})`.as("member_count"),
      })
      .from(dimEnterpriseTeam)
      .leftJoin(
        dimEnterpriseTeamMember,
        eq(dimEnterpriseTeam.teamId, dimEnterpriseTeamMember.teamId),
      )
      .groupBy(
        dimEnterpriseTeam.teamId,
        dimEnterpriseTeam.githubTeamId,
        dimEnterpriseTeam.teamName,
        dimEnterpriseTeam.teamSlug,
        dimEnterpriseTeam.description,
      )
      .orderBy(dimEnterpriseTeam.teamName);

    return NextResponse.json({
      teams: teams.map((t) => ({
        id: t.teamId,
        githubTeamId: t.githubTeamId,
        name: t.teamName,
        slug: t.teamSlug,
        description: t.description,
        memberCount: Number(t.memberCount),
      })),
    });
  } catch (err) {
    console.error("Failed to fetch enterprise teams:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to fetch enterprise teams") },
      { status: 500 },
    );
  }
}
