import { and, gte, lte, eq, sql } from "drizzle-orm";
import { db } from "./index";
import {
  factCopilotUsageDaily,
  dimOrg,
  dimEnterpriseTeam,
  dimEnterpriseTeamMember,
} from "./schema";
import {
  resolveTeamAwareUserFilter,
  buildTeamAwareCondition,
  type TeamAwareFilterInput,
} from "./team-filter";

/**
 * AI credit consumption derived from the per-user `ai_credits_used` field of the
 * Copilot Usage Metrics API (user-level reports, 2026-06-19), persisted on
 * `fact_copilot_usage_daily`. This is a consumption *signal* — an overall
 * per-user total not broken down by model/feature/surface — and is distinct
 * from the billed AI Credit dollars sourced from the usage-based billing API.
 *
 * Because the billing endpoint never returns per-user/per-team rows, this is the
 * source that makes the user / team / org filters on the AI Credits report work.
 */

export interface UserCreditConsumption {
  userId: number;
  userLogin: string;
  creditsUsed: number;
  daysActive: number;
}

export interface OrgCreditConsumption {
  orgId: number;
  orgName: string;
  creditsUsed: number;
}

export interface TeamCreditConsumption {
  teamId: number;
  teamName: string;
  teamSlug: string;
  creditsUsed: number;
  members: number;
}

export interface CreditConsumptionOptions {
  users: Array<{ userId: number; userLogin: string }>;
  orgs: Array<{ id: number; name: string }>;
  teams: Array<{ id: number; name: string; slug: string; memberCount: number }>;
}

export interface CreditConsumptionResult {
  /** True when any per-user credit signal exists for the window. */
  available: boolean;
  totalCreditsUsed: number;
  activeUsers: number;
  perUser: UserCreditConsumption[];
  perOrg: OrgCreditConsumption[];
  perTeam: TeamCreditConsumption[];
  options: CreditConsumptionOptions;
}

const round2 = (v: number): number => Math.round(v * 100) / 100;

export function emptyConsumption(): CreditConsumptionResult {
  return {
    available: false,
    totalCreditsUsed: 0,
    activeUsers: 0,
    perUser: [],
    perOrg: [],
    perTeam: [],
    options: { users: [], orgs: [], teams: [] },
  };
}

/**
 * Aggregate per-user / per-org / per-team AI credit consumption for a date
 * window, honoring the standard team-aware user/org/team filters. Best-effort:
 * returns an empty result if the table or column is unavailable (e.g. before the
 * migration has run), so the live cost report keeps working.
 */
export async function getCreditConsumption(
  startDate: string,
  endDate: string,
  filter: TeamAwareFilterInput,
): Promise<CreditConsumptionResult> {
  try {
    const ctx = await resolveTeamAwareUserFilter(filter);
    const teamCond = buildTeamAwareCondition(
      factCopilotUsageDaily.userId,
      ctx.userIds,
      ctx.teamFilterApplied,
      ctx.selectedGithubTeamIds,
      factCopilotUsageDaily.sourceTeamGithubId,
    );
    const baseWhere = and(
      gte(factCopilotUsageDaily.day, startDate),
      lte(factCopilotUsageDaily.day, endDate),
      ...(teamCond ? [teamCond] : []),
    );

    const creditExpr = sql<number>`COALESCE(SUM(${factCopilotUsageDaily.aiCreditsUsed}), 0)::float8`;

    const perUserRows = await db
      .select({
        userId: factCopilotUsageDaily.userId,
        userLogin: factCopilotUsageDaily.userLogin,
        creditsUsed: creditExpr,
        daysActive: sql<number>`COUNT(DISTINCT ${factCopilotUsageDaily.day})::int`,
      })
      .from(factCopilotUsageDaily)
      .where(baseWhere)
      .groupBy(factCopilotUsageDaily.userId, factCopilotUsageDaily.userLogin);

    const perUser = perUserRows
      .map((r) => ({
        userId: r.userId,
        userLogin: r.userLogin,
        creditsUsed: round2(Number(r.creditsUsed)),
        daysActive: Number(r.daysActive),
      }))
      .filter((r) => r.creditsUsed > 0)
      .sort((a, b) => b.creditsUsed - a.creditsUsed);

    const perOrgRows = await db
      .select({
        orgId: dimOrg.orgId,
        orgName: dimOrg.orgName,
        creditsUsed: creditExpr,
      })
      .from(factCopilotUsageDaily)
      .innerJoin(dimOrg, eq(factCopilotUsageDaily.orgId, dimOrg.orgId))
      .where(baseWhere)
      .groupBy(dimOrg.orgId, dimOrg.orgName);

    const perOrg = perOrgRows
      .map((r) => ({
        orgId: r.orgId,
        orgName: r.orgName,
        creditsUsed: round2(Number(r.creditsUsed)),
      }))
      .filter((r) => r.creditsUsed > 0)
      .sort((a, b) => b.creditsUsed - a.creditsUsed);

    // Team attribution uses the enterprise team roster (dim_enterprise_team_member).
    const perTeamRows = await db
      .select({
        teamId: dimEnterpriseTeam.teamId,
        teamName: dimEnterpriseTeam.teamName,
        teamSlug: dimEnterpriseTeam.teamSlug,
        creditsUsed: creditExpr,
        members: sql<number>`COUNT(DISTINCT ${factCopilotUsageDaily.userId})::int`,
      })
      .from(factCopilotUsageDaily)
      .innerJoin(
        dimEnterpriseTeamMember,
        eq(dimEnterpriseTeamMember.userId, factCopilotUsageDaily.userId),
      )
      .innerJoin(dimEnterpriseTeam, eq(dimEnterpriseTeam.teamId, dimEnterpriseTeamMember.teamId))
      .where(baseWhere)
      .groupBy(dimEnterpriseTeam.teamId, dimEnterpriseTeam.teamName, dimEnterpriseTeam.teamSlug);

    const perTeam = perTeamRows
      .map((r) => ({
        teamId: r.teamId,
        teamName: r.teamName,
        teamSlug: r.teamSlug,
        creditsUsed: round2(Number(r.creditsUsed)),
        members: Number(r.members),
      }))
      .filter((r) => r.creditsUsed > 0)
      .sort((a, b) => b.creditsUsed - a.creditsUsed);

    const totalCreditsUsed = round2(perUser.reduce((sum, u) => sum + u.creditsUsed, 0));
    const options = await getConsumptionOptions(startDate, endDate);

    return {
      available: totalCreditsUsed > 0 || options.users.length > 0,
      totalCreditsUsed,
      activeUsers: perUser.length,
      perUser,
      perOrg,
      perTeam,
      options,
    };
  } catch (err) {
    console.warn("getCreditConsumption failed (cost report continues):", err);
    return emptyConsumption();
  }
}

/**
 * Filter option lists for the consumption dimensions, independent of the current
 * selection so dropdowns always offer every choice. Users/orgs are scoped to the
 * window; enterprise teams are listed in full with their roster size.
 */
async function getConsumptionOptions(
  startDate: string,
  endDate: string,
): Promise<CreditConsumptionOptions> {
  const windowWhere = and(
    gte(factCopilotUsageDaily.day, startDate),
    lte(factCopilotUsageDaily.day, endDate),
  );

  const [userRows, orgRows, teamRows] = await Promise.all([
    db
      .selectDistinct({
        userId: factCopilotUsageDaily.userId,
        userLogin: factCopilotUsageDaily.userLogin,
      })
      .from(factCopilotUsageDaily)
      .where(windowWhere)
      .orderBy(factCopilotUsageDaily.userLogin),

    db
      .select({ id: dimOrg.orgId, name: dimOrg.orgName })
      .from(factCopilotUsageDaily)
      .innerJoin(dimOrg, eq(factCopilotUsageDaily.orgId, dimOrg.orgId))
      .where(windowWhere)
      .groupBy(dimOrg.orgId, dimOrg.orgName)
      .orderBy(dimOrg.orgName),

    db
      .select({
        id: dimEnterpriseTeam.teamId,
        name: dimEnterpriseTeam.teamName,
        slug: dimEnterpriseTeam.teamSlug,
        memberCount: sql<number>`COUNT(DISTINCT ${dimEnterpriseTeamMember.id})::int`,
      })
      .from(dimEnterpriseTeam)
      .leftJoin(dimEnterpriseTeamMember, eq(dimEnterpriseTeam.teamId, dimEnterpriseTeamMember.teamId))
      .groupBy(dimEnterpriseTeam.teamId, dimEnterpriseTeam.teamName, dimEnterpriseTeam.teamSlug)
      .orderBy(dimEnterpriseTeam.teamName),
  ]);

  return {
    users: userRows.map((u) => ({ userId: u.userId, userLogin: u.userLogin })),
    orgs: orgRows.map((o) => ({ id: o.id, name: o.name })),
    teams: teamRows.map((tm) => ({
      id: tm.id,
      name: tm.name,
      slug: tm.slug,
      memberCount: Number(tm.memberCount),
    })),
  };
}
