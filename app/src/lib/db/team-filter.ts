import { and, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { dimEnterpriseTeam, dimEnterpriseTeamMember, dimUser } from "@/lib/db/schema";

function parseCsvInts(value?: string): number[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n));
}

export interface TeamAwareFilterInput {
  userId?: number;
  userIds?: number[];
  teamName?: string;
  orgId?: string;
  teamId?: string;
}

export interface TeamAwareFilterContext {
  teamFilterApplied: boolean;
  selectedGithubTeamIds: number[];
  userIds: number[] | null;
}

export async function resolveTeamAwareUserFilter(
  params: TeamAwareFilterInput,
): Promise<TeamAwareFilterContext> {
  const orgIds = parseCsvInts(params.orgId);
  const selectedLocalTeamIds = parseCsvInts(params.teamId);
  const teamFilterApplied = selectedLocalTeamIds.length > 0;
  const userIdList =
    params.userIds && params.userIds.length > 0
      ? params.userIds
      : params.userId != null
        ? [params.userId]
        : [];
  const hasUserFilter = userIdList.length > 0;

  let selectedGithubTeamIds: number[] = [];
  let teamMemberUserIds: number[] = [];

  if (teamFilterApplied) {
    const selectedTeams = await db
      .select({
        teamId: dimEnterpriseTeam.teamId,
        githubTeamId: dimEnterpriseTeam.githubTeamId,
      })
      .from(dimEnterpriseTeam)
      .where(inArray(dimEnterpriseTeam.teamId, selectedLocalTeamIds));

    selectedGithubTeamIds = selectedTeams.map((t) => t.githubTeamId);

    if (selectedTeams.length > 0) {
      const members = await db
        .selectDistinct({ userId: dimEnterpriseTeamMember.userId })
        .from(dimEnterpriseTeamMember)
        .where(inArray(dimEnterpriseTeamMember.teamId, selectedTeams.map((t) => t.teamId)));
      teamMemberUserIds = members.map((m) => m.userId);
    }
  }

  if (!hasUserFilter && !params.teamName && orgIds.length === 0 && !teamFilterApplied) {
    return { teamFilterApplied: false, selectedGithubTeamIds: [], userIds: null };
  }

  if (teamFilterApplied && teamMemberUserIds.length === 0) {
    return { teamFilterApplied, selectedGithubTeamIds, userIds: [] };
  }

  if (
    teamFilterApplied &&
    !hasUserFilter &&
    !params.teamName &&
    orgIds.length === 0
  ) {
    return {
      teamFilterApplied,
      selectedGithubTeamIds,
      userIds: teamMemberUserIds,
    };
  }

  const conditions = [eq(dimUser.isCurrent, true)];

  if (userIdList.length === 1) conditions.push(eq(dimUser.userId, userIdList[0]));
  else if (userIdList.length > 1) conditions.push(inArray(dimUser.userId, userIdList));
  if (params.teamName) conditions.push(eq(dimUser.teamName, params.teamName));
  if (orgIds.length === 1) conditions.push(eq(dimUser.orgId, orgIds[0]));
  else if (orgIds.length > 1) conditions.push(inArray(dimUser.orgId, orgIds));
  if (teamFilterApplied) conditions.push(inArray(dimUser.userId, teamMemberUserIds));

  const users = await db
    .selectDistinct({ userId: dimUser.userId })
    .from(dimUser)
    .where(and(...conditions));

  return {
    teamFilterApplied,
    selectedGithubTeamIds,
    userIds: users.map((u) => u.userId),
  };
}

export function buildTeamAwareCondition(
  factUserIdCol: any,
  userIds: number[] | null,
  teamFilterApplied: boolean,
  selectedGithubTeamIds: number[],
  factSourceTeamGithubIdCol?: any,
) {
  if (!teamFilterApplied) {
    if (userIds === null) return null;
    if (userIds.length === 0) return sql`1 = 0`;
    return inArray(factUserIdCol, userIds);
  }

  const hasNative = !!factSourceTeamGithubIdCol && selectedGithubTeamIds.length > 0;
  const hasUsers = userIds !== null && userIds.length > 0;

  if (hasNative && hasUsers) {
    return or(
      inArray(factSourceTeamGithubIdCol, selectedGithubTeamIds),
      and(
        isNull(factSourceTeamGithubIdCol),
        inArray(factUserIdCol, userIds),
      ),
    );
  }
  if (hasNative) {
    return inArray(factSourceTeamGithubIdCol, selectedGithubTeamIds);
  }
  if (hasUsers) {
    return inArray(factUserIdCol, userIds);
  }
  return sql`1 = 0`;
}

function intArraySql(values: number[]): SQL {
  if (values.length === 0) return sql`ARRAY[]::int[]`;
  return sql`ARRAY[${sql.join(values.map((id) => sql`${id}`), sql`, `)}]::int[]`;
}

export function buildRawTeamAwareSql(
  userIds: number[] | null,
  teamFilterApplied: boolean,
  selectedGithubTeamIds: number[],
): SQL {
  if (!teamFilterApplied) {
    if (userIds === null) return sql``;
    if (userIds.length === 0) return sql`AND 1 = 0`;
    return sql`AND r.user_id = ANY(${intArraySql(userIds)})`;
  }

  const hasNative = selectedGithubTeamIds.length > 0;
  const hasUsers = userIds !== null && userIds.length > 0;

  if (hasNative && hasUsers) {
    return sql`AND (
      r.source_team_github_id = ANY(${intArraySql(selectedGithubTeamIds)})
      OR (r.source_team_github_id IS NULL AND r.user_id = ANY(${intArraySql(userIds)}))
    )`;
  }
  if (hasNative) return sql`AND r.source_team_github_id = ANY(${intArraySql(selectedGithubTeamIds)})`;
  if (hasUsers) return sql`AND r.user_id = ANY(${intArraySql(userIds)})`;
  return sql`AND 1 = 0`;
}
