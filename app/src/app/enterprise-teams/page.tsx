"use client";

import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { useChartOptions } from "@/lib/theme/chart-theme";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { PageHeader } from "@/components/layout/page-header";
import { UsersRound, RefreshCw, ChevronRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Types ── */

interface Team {
  id: number;
  name: string;
  slug: string;
  memberCount: number;
}

interface TeamMember {
  userId: number;
  userLogin: string;
  role: string;
}

/* ── Page ── */

export default function EnterpriseTeamsPage() {
  const { t } = useTranslation();
  // Keep chart options available for future chart additions
  useChartOptions();

  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [loadingTeams, setLoadingTeams] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [syncing, setSyncing] = useState(false);

  /* ── Fetch teams ── */

  const fetchTeams = useCallback(async () => {
    setLoadingTeams(true);
    try {
      const res = await fetch("/api/enterprise-teams");
      if (!res.ok) throw new Error(`Failed to fetch teams: ${res.status}`);
      const data = await res.json();
      setTeams(Array.isArray(data.teams) ? data.teams : []);
    } catch (err) {
      console.error("[enterprise-teams] Error fetching teams:", err);
      setTeams([]);
    } finally {
      setLoadingTeams(false);
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  /* ── Fetch members for selected team ── */

  const fetchMembers = useCallback(async (teamId: number) => {
    setLoadingMembers(true);
    setMembers([]);
    try {
      const res = await fetch(`/api/enterprise-teams/${teamId}/members`);
      if (!res.ok) throw new Error(`Failed to fetch members: ${res.status}`);
      const data = await res.json();
      setMembers(Array.isArray(data.members) ? data.members : []);
    } catch (err) {
      console.error("[enterprise-teams] Error fetching members:", err);
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const handleSelectTeam = useCallback(
    (teamId: number) => {
      setSelectedTeamId(teamId);
      fetchMembers(teamId);
    },
    [fetchMembers],
  );

  /* ── Sync teams ── */

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/enterprise-teams/sync", { method: "POST" });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      await fetchTeams();
      setSelectedTeamId(null);
      setMembers([]);
    } catch (err) {
      console.error("[enterprise-teams] Sync error:", err);
    } finally {
      setSyncing(false);
    }
  }, [fetchTeams]);

  /* ── Derived stats ── */

  const totalMembers = teams.reduce((sum, team) => sum + team.memberCount, 0);
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  /* ── Loading state ── */

  if (loadingTeams) {
    return (
      <div className="flex h-full items-center justify-center">
        <LoadingSpinner message={t("teams.loadingTeams")} />
      </div>
    );
  }

  /* ── Render ── */

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("teams.title")}
        subtitle={t("teams.subtitle")}
        actions={
          <button
            type="button"
            disabled={syncing}
            onClick={handleSync}
            className={cn(
              "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-xs transition-colors",
              syncing
                ? "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500"
                : "bg-blue-600 text-white hover:bg-blue-700",
            )}
          >
            <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            {syncing ? t("teams.syncing") : t("teams.syncTeams")}
          </button>
        }
      />

      {/* About this page */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-medium">{t("teams.aboutTitle")}</p>
          <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
            {t("teams.aboutBody")}
          </p>
        </div>
      </div>

      {/* Summary stats */}
      {teams.length > 0 && (
        <div className="flex gap-4">
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {teams.length}
            </span>
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
              {t("teams.teamsSynced")}
            </span>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {totalMembers}
            </span>
            <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
              {t("teams.totalMembers")}
            </span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {teams.length === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 rounded-full bg-gray-100 p-4 dark:bg-gray-700">
            <UsersRound className="h-8 w-8 text-gray-400 dark:text-gray-500" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("teams.noTeams")}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            {t("teams.noTeamsDesc")}
          </p>
        </div>
      )}

      {/* Two-column layout */}
      {teams.length > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Left: Team list */}
          <div className="lg:col-span-1">
            <div className="space-y-2">
              {teams.map((team) => (
                <button
                  key={team.id}
                  type="button"
                  onClick={() => handleSelectTeam(team.id)}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-4 py-3 text-start transition-colors",
                    selectedTeamId === team.id
                      ? "border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/30"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:hover:bg-gray-700",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-sm font-medium",
                        selectedTeamId === team.id
                          ? "text-blue-700 dark:text-blue-400"
                          : "text-gray-900 dark:text-gray-100",
                      )}
                    >
                      {team.name}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {team.slug}
                    </p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {team.memberCount} {t("teams.members")}
                    </p>
                  </div>
                  <ChevronRight
                    className={cn(
                      "h-4 w-4 shrink-0",
                      selectedTeamId === team.id
                        ? "text-blue-500 dark:text-blue-400"
                        : "text-gray-400 dark:text-gray-500",
                    )}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* Right: Members panel */}
          <div className="lg:col-span-2">
            <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              {!selectedTeam && (
                <div className="flex h-64 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                  {t("teams.selectTeam")}
                </div>
              )}

              {selectedTeam && loadingMembers && (
                <div className="flex h-64 items-center justify-center">
                  <LoadingSpinner size="sm" message={t("teams.loadingTeams")} />
                </div>
              )}

              {selectedTeam && !loadingMembers && (
                <div>
                  {/* Panel header */}
                  <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {selectedTeam.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {members.length} {t("teams.members")}
                    </p>
                  </div>

                  {/* Members table */}
                  {members.length === 0 ? (
                    <div className="flex h-48 items-center justify-center text-sm text-gray-500 dark:text-gray-400">
                      {t("teams.noMembers")}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                            <th className="px-4 py-2 text-start text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              Login
                            </th>
                            <th className="px-4 py-2 text-start text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                              {t("teams.role")}
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                          {members.map((member) => (
                            <tr
                              key={member.userId}
                              className="transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50"
                            >
                              <td className="whitespace-nowrap px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                                {member.userLogin}
                              </td>
                              <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">
                                <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                                  {member.role}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
