/**
 * Controllable ETL sync scheduler.
 *
 * Holds a singleton timer that can be started, stopped, and queried
 * for status at runtime via API routes — no app restart needed.
 */

import type { SyncScope } from "@/lib/db/settings";

let timer: ReturnType<typeof setTimeout> | null = null;
let schedulerEnabled = false;
let intervalMinutes = 1440; // default 24h
let nextRunAt: Date | null = null;
let lastRunAt: Date | null = null;

function formatLabel(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

async function runIngestion() {
  try {
    const { getGitHubConfig, getSyncScopeConfig } = await import("@/lib/db/settings");
    const { ingestCopilotUsage } = await import("@/lib/etl/ingest");
    const { syncEnterpriseTeams } = await import("@/lib/etl/enterprise-teams");
    const { syncEnterpriseContext } = await import("@/lib/etl/enterprise-context");
    const { db } = await import("@/lib/db");
    const { ingestionLog } = await import("@/lib/db/schema");
    const { token, enterpriseSlug } = await getGitHubConfig();
    const { scopes: configuredScopes, orgLogins } = await getSyncScopeConfig();
    lastRunAt = new Date();
    if (!token || !enterpriseSlug) {
      console.warn("Scheduled ingest skipped — GitHub token or slug not configured");
      // Log the skipped run so it appears in history
      const today = new Date().toISOString().split("T")[0];
      await db.insert(ingestionLog).values({
        ingestionDate: today,
        source: "scheduled",
        status: "error",
        completedAt: new Date(),
        errorMessage: "Skipped — GitHub token or enterprise slug not configured",
      });
      return;
    }

    // Ensure org-level data is always fetched so PR metrics and Copilot Autofix
    // data (from org aggregate endpoint) are included in every scheduled sync.
    const hasOrgScope = configuredScopes.includes("all_orgs") || configuredScopes.includes("organization");
    const scopes: SyncScope[] = hasOrgScope
      ? configuredScopes
      : [...configuredScopes, "all_orgs"];

    const orgLabel = scopes.includes("organization") ? `, orgs: ${orgLogins.join(", ")}` : "";
    console.info(`Scheduled ETL ingestion started (scopes: ${scopes.join("+")}${orgLabel})`);
    const result = await ingestCopilotUsage({ token, enterpriseSlug, source: "scheduled", scopes, orgLogins });
    console.info(
      `Scheduled ETL ingestion complete — fetched: ${result.recordsFetched}, inserted: ${result.recordsInserted}, skipped: ${result.recordsSkipped}`
    );

    // Sync enterprise teams + memberships alongside usage data
    try {
      console.info("Scheduled enterprise teams sync started");
      const teamsResult = await syncEnterpriseTeams({ enterpriseSlug, token, source: "scheduled" });
      console.info(
        `Scheduled enterprise teams sync complete — teams: ${teamsResult.teamsSynced}, members: ${teamsResult.totalMembers}`
      );
    } catch (teamsErr) {
      console.error("Scheduled enterprise teams sync failed:", teamsErr);
    }

    try {
      console.info("Scheduled enterprise context sync started");
      const contextResult = await syncEnterpriseContext({ enterpriseSlug, token });
      const seatsLabel = contextResult.seats.status === "success"
        ? `${contextResult.seats.assignmentsSynced}`
        : `skipped (${contextResult.seats.error})`;
      const orgMembersLabel = contextResult.orgMembers.status === "success"
        ? `${contextResult.orgMembers.membersSynced}`
        : `skipped (${contextResult.orgMembers.error})`;
      console.info(
        `Scheduled enterprise context sync complete — seats: ${seatsLabel}, org members: ${orgMembersLabel}`,
      );
    } catch (contextErr) {
      console.error("Scheduled enterprise context sync failed:", contextErr);
    }

    // Persist per-user AI Credit usage via the async report export so the
    // dashboard can read rows from the DB instead of a live export on page load.
    // (Issue C2 moves this to a dedicated cron Job and removes it from here.)
    try {
      const { ingestAiCreditUsage } = await import("@/lib/etl/ai-credit-report");
      console.info("Scheduled AI Credit ingestion started");
      const creditResult = await ingestAiCreditUsage({ token, enterpriseSlug });
      console.info(
        `Scheduled AI Credit ingestion complete — rows: ${creditResult.rowsPersisted}, months: ${creditResult.monthsPersisted}`
      );
    } catch (creditErr) {
      console.error("Scheduled AI Credit ingestion failed:", creditErr);
    }

    // Enforce audit-log retention so the table doesn't grow unbounded.
    try {
      const { pruneAuditLog } = await import("@/lib/audit");
      await pruneAuditLog();
    } catch (pruneErr) {
      console.error("Scheduled audit-log prune failed:", pruneErr);
    }
  } catch (err) {
    console.error("Scheduled ETL ingestion failed:", err);
  }
}

function scheduleNext() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!schedulerEnabled) {
    nextRunAt = null;
    return;
  }
  const ms = intervalMinutes * 60 * 1000;
  nextRunAt = new Date(Date.now() + ms);
  timer = setTimeout(async () => {
    // Immediately set the next run target so the countdown stays visible during ingestion
    nextRunAt = new Date(Date.now() + intervalMinutes * 60 * 1000);
    await runIngestion();
    // After completing, properly reschedule the timer
    if (schedulerEnabled) {
      scheduleNext();
    }
  }, ms);
}

/**
 * Start the automatic sync scheduler.
 */
export function startScheduler(minutes?: number) {
  if (minutes !== undefined && minutes > 0) {
    intervalMinutes = minutes;
  }
  schedulerEnabled = true;
  scheduleNext();
  console.info(`Sync scheduler started — every ${formatLabel(intervalMinutes)}, next run at ${nextRunAt?.toISOString()}`);
}

/**
 * Stop the automatic sync scheduler.
 */
export function stopScheduler() {
  schedulerEnabled = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  nextRunAt = null;
  console.info("Sync scheduler stopped");
}

/**
 * Update the interval without stopping/starting if already running.
 */
export function updateInterval(minutes: number) {
  intervalMinutes = minutes;
  if (schedulerEnabled) {
    scheduleNext();
    console.info(`Sync scheduler interval updated to ${formatLabel(minutes)}, next run at ${nextRunAt?.toISOString()}`);
  }
}

/**
 * Get current scheduler status.
 */
export function getSchedulerStatus() {
  return {
    enabled: schedulerEnabled,
    intervalMinutes,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    lastRunAt: lastRunAt?.toISOString() ?? null,
  };
}
