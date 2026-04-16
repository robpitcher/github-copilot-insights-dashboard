import { NextResponse } from "next/server";
import { getGitHubConfig } from "@/lib/db/settings";
import { syncEnterpriseTeams } from "@/lib/etl/enterprise-teams";
import { safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const config = await getGitHubConfig();
    if (!config.token || !config.enterpriseSlug) {
      return NextResponse.json(
        { error: "GitHub token and enterprise slug must be configured" },
        { status: 400 },
      );
    }

    const result = await syncEnterpriseTeams({
      enterpriseSlug: config.enterpriseSlug,
      token: config.token,
      source: "api",
    });

    console.info(
      `Enterprise teams sync complete: ${result.teamsSynced} teams, ${result.totalMembers} members`,
    );

    return NextResponse.json({
      success: true,
      teamsSynced: result.teamsSynced,
      totalMembers: result.totalMembers,
    });
  } catch (err) {
    console.error("Failed to sync enterprise teams:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Failed to sync enterprise teams") },
      { status: 500 },
    );
  }
}
