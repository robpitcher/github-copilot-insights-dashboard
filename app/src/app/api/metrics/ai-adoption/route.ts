import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { factCopilotUsageDaily } from "@/lib/db/schema";
import { sql, and, gte, lte, isNotNull, desc } from "drizzle-orm";
import { daysAgo, isValidDate } from "@/lib/utils";
import { z } from "zod";
import { getGitHubConfig } from "@/lib/db/settings";
import { resolveDisplayNames, formatUserLabel } from "@/lib/github/resolve-display-names";
import { safeErrorMessage } from "@/lib/auth";
import { buildTeamAwareCondition, resolveTeamAwareUserFilter } from "@/lib/db/team-filter";
import { AI_ADOPTION_PHASES, AI_ADOPTION_PHASE_KEYS, AI_ADOPTION_PHASE_LABELS } from "@/types/copilot-api";

const querySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional(),
  start: z.string().refine(isValidDate).optional(),
  end: z.string().refine(isValidDate).optional(),
  userId: z.coerce.number().int().optional(),
  teamName: z.string().optional(),
  orgId: z.string().optional(),
  teamId: z.string().optional(),
});

const PHASE_META = AI_ADOPTION_PHASES.map((phase) => ({
  phase,
  key: AI_ADOPTION_PHASE_KEYS[phase],
  label: AI_ADOPTION_PHASE_LABELS[phase],
}));

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const params = querySchema.parse({
      days: sp.get("days") ?? undefined,
      start: sp.get("start") ?? undefined,
      end: sp.get("end") ?? undefined,
      userId: sp.get("userId") ?? undefined,
      teamName: sp.get("teamName") ?? undefined,
      orgId: sp.get("orgId") ?? undefined,
      teamId: sp.get("teamId") ?? undefined,
    });

    const endDate = params.end ?? new Date().toISOString().split("T")[0];
    const startDate = params.start ?? daysAgo(params.days ?? 28);
    const { userIds, teamFilterApplied, selectedGithubTeamIds } =
      await resolveTeamAwareUserFilter(params);

    // Shared WHERE: date window + team-aware filter + only classified rows.
    const classifiedWhere = () => {
      const conds = [
        gte(factCopilotUsageDaily.day, startDate),
        lte(factCopilotUsageDaily.day, endDate),
        isNotNull(factCopilotUsageDaily.aiAdoptionPhase),
      ];
      const teamAware = buildTeamAwareCondition(
        factCopilotUsageDaily.userId,
        userIds,
        teamFilterApplied,
        selectedGithubTeamIds,
        factCopilotUsageDaily.sourceTeamGithubId,
      );
      if (teamAware) conds.push(teamAware);
      return and(...conds);
    };

    const [latestPhasePerUser, progressionRows, perPhaseRows, topUserRows] =
      await Promise.all([
        // 1. Each user's most-recent classified phase within the window.
        db
          .selectDistinctOn([factCopilotUsageDaily.userId], {
            userId: factCopilotUsageDaily.userId,
            phase: factCopilotUsageDaily.aiAdoptionPhase,
          })
          .from(factCopilotUsageDaily)
          .where(classifiedWhere())
          .orderBy(factCopilotUsageDaily.userId, desc(factCopilotUsageDaily.day)),

        // 2. Distinct users per phase per day (progression over time).
        db
          .select({
            date: factCopilotUsageDaily.day,
            phase: factCopilotUsageDaily.aiAdoptionPhase,
            users: sql<number>`COUNT(DISTINCT ${factCopilotUsageDaily.userId})`,
          })
          .from(factCopilotUsageDaily)
          .where(classifiedWhere())
          .groupBy(factCopilotUsageDaily.day, factCopilotUsageDaily.aiAdoptionPhase)
          .orderBy(factCopilotUsageDaily.day),

        // 3. Per-phase activity aggregates (averaged per engaged user).
        db
          .select({
            phase: factCopilotUsageDaily.aiAdoptionPhase,
            users: sql<number>`COUNT(DISTINCT ${factCopilotUsageDaily.userId})`,
            sumInteractions: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.userInitiatedInteractionCount}), 0)`,
            sumCodeGen: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.codeGenerationActivityCount}), 0)`,
            sumCodeAccept: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.codeAcceptanceActivityCount}), 0)`,
            sumLocAdded: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.locAddedSum}), 0)`,
            sumLocDeleted: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.locDeletedSum}), 0)`,
          })
          .from(factCopilotUsageDaily)
          .where(classifiedWhere())
          .groupBy(factCopilotUsageDaily.aiAdoptionPhase),

        // 4. Per-user totals for the breakdown table.
        db
          .select({
            userId: factCopilotUsageDaily.userId,
            userLogin: factCopilotUsageDaily.userLogin,
            daysActive: sql<number>`COUNT(DISTINCT ${factCopilotUsageDaily.day})`,
            interactions: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.userInitiatedInteractionCount}), 0)`,
            codeGenerated: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.codeGenerationActivityCount}), 0)`,
            codeAccepted: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.codeAcceptanceActivityCount}), 0)`,
            locAdded: sql<number>`COALESCE(SUM(${factCopilotUsageDaily.locAddedSum}), 0)`,
          })
          .from(factCopilotUsageDaily)
          .where(classifiedWhere())
          .groupBy(factCopilotUsageDaily.userId, factCopilotUsageDaily.userLogin)
          .orderBy(sql`SUM(${factCopilotUsageDaily.userInitiatedInteractionCount}) DESC`)
          .limit(200),
      ]);

    // ── Current-phase distribution (each user counted once, by latest phase) ──
    const phaseUserCounts = new Map<number, number>();
    const userPhaseMap = new Map<number, number>();
    for (const row of latestPhasePerUser) {
      const phase = Number(row.phase);
      userPhaseMap.set(row.userId, phase);
      phaseUserCounts.set(phase, (phaseUserCounts.get(phase) ?? 0) + 1);
    }

    const classifiedUsers = latestPhasePerUser.length;
    const engagedUsers = PHASE_META.filter((p) => p.phase >= 1).reduce(
      (sum, p) => sum + (phaseUserCounts.get(p.phase) ?? 0),
      0,
    );

    const distribution = PHASE_META.map((p) => {
      const users = phaseUserCounts.get(p.phase) ?? 0;
      return {
        phase: p.phase,
        key: p.key,
        label: p.label,
        users,
        share: classifiedUsers > 0 ? Math.round((users / classifiedUsers) * 1000) / 10 : 0,
      };
    });

    const pct = (count: number, total: number) =>
      total > 0 ? Math.round((count / total) * 1000) / 10 : 0;

    const codeFirst = phaseUserCounts.get(1) ?? 0;
    const agentFirst = phaseUserCounts.get(2) ?? 0;
    const multiAgent = phaseUserCounts.get(3) ?? 0;
    const noCohort = phaseUserCounts.get(0) ?? 0;

    // ── Progression over time (pivot day → per-phase user counts) ──
    const progMap = new Map<string, Record<string, string | number>>();
    for (const row of progressionRows) {
      const d = String(row.date);
      if (!progMap.has(d)) {
        progMap.set(d, { date: d, noCohort: 0, codeFirst: 0, agentFirst: 0, multiAgent: 0 });
      }
      const entry = progMap.get(d)!;
      const key = AI_ADOPTION_PHASE_KEYS[Number(row.phase) as 0 | 1 | 2 | 3];
      if (key) entry[key] = Number(row.users);
    }
    const progressionOverTime = Array.from(progMap.values());

    // ── Per-phase averaged metrics ──
    const perPhaseRowMap = new Map(perPhaseRows.map((r) => [Number(r.phase), r]));
    const avg = (sum: number, users: number) =>
      users > 0 ? Math.round((sum / users) * 10) / 10 : 0;
    const perPhaseMetrics = PHASE_META.map((p) => {
      const r = perPhaseRowMap.get(p.phase);
      const users = Number(r?.users ?? 0);
      return {
        phase: p.phase,
        key: p.key,
        label: p.label,
        users,
        avgInteractions: avg(Number(r?.sumInteractions ?? 0), users),
        avgCodeGenerated: avg(Number(r?.sumCodeGen ?? 0), users),
        avgCodeAccepted: avg(Number(r?.sumCodeAccept ?? 0), users),
        avgLocAdded: avg(Number(r?.sumLocAdded ?? 0), users),
        avgLocDeleted: avg(Number(r?.sumLocDeleted ?? 0), users),
      };
    });

    // ── Top users with their current phase + resolved display names ──
    const logins = topUserRows.map((u) => u.userLogin);
    const { token } = await getGitHubConfig();
    const displayNameMap = token
      ? await resolveDisplayNames(logins, token)
      : new Map<string, string>();
    const topUsers = topUserRows.map((u) => {
      const phase = userPhaseMap.get(u.userId) ?? null;
      return {
        userId: u.userId,
        userLogin: u.userLogin,
        displayLabel: formatUserLabel(u.userLogin, displayNameMap),
        phase,
        phaseKey: phase !== null ? AI_ADOPTION_PHASE_KEYS[phase as 0 | 1 | 2 | 3] : null,
        phaseLabel: phase !== null ? AI_ADOPTION_PHASE_LABELS[phase as 0 | 1 | 2 | 3] : null,
        daysActive: Number(u.daysActive),
        interactions: Number(u.interactions),
        codeGenerated: Number(u.codeGenerated),
        codeAccepted: Number(u.codeAccepted),
        locAdded: Number(u.locAdded),
      };
    });

    return NextResponse.json({
      period: { start: startDate, end: endDate },
      kpis: {
        classifiedUsers,
        engagedUsers,
        codeFirstUsers: codeFirst,
        agentFirstUsers: agentFirst,
        multiAgentUsers: multiAgent,
        noCohortUsers: noCohort,
        multiAgentRate: pct(multiAgent, engagedUsers),
        agentAdoptionRate: pct(agentFirst + multiAgent, engagedUsers),
        codeFirstRate: pct(codeFirst, engagedUsers),
      },
      distribution,
      progressionOverTime,
      perPhaseMetrics,
      topUsers,
    });
  } catch (err) {
    console.error("AI Adoption Metrics API error:", err);
    return NextResponse.json(
      { error: safeErrorMessage(err, "Internal server error") },
      { status: 500 },
    );
  }
}
