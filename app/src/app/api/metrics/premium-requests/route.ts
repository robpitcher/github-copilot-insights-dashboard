import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGitHubConfig } from "@/lib/db/settings";
import { resolveDisplayNames, formatUserLabel } from "@/lib/github/resolve-display-names";
import { getModelDisplayName } from "@/lib/utils/model-display-names";
import { safeErrorMessage, getIdentitySessionFromRequest, resolveUserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";

/** Per-user/month included premium request quotas by plan. */
const PLAN_QUOTAS: Record<string, number> = {
  business: 300,
  enterprise: 1000,
};

interface BillingUsageItem {
  date: string;
  organizationName?: string;
  repositoryName?: string;
  user?: string;
  team?: string;
  sku?: string;
  unitType?: string;
  grossQuantity?: number;
  grossAmount?: number;
  discountAmount?: number;
  netQuantity?: number;
  netAmount?: number;
}

interface BillingUsageResponse {
  usageItems: BillingUsageItem[];
}

interface SeatInfo {
  plan_type: string;
  assignee: { login: string };
}

interface SeatsResponse {
  seats: SeatInfo[];
}

const querySchema = z.object({
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  model: z.string().optional(),
  org: z.string().optional(),
  user: z.string().optional(),
  team: z.string().optional(),
});

class GitHubHttpError extends Error {
  status: number;
  statusText: string;
  body: string;

  constructor(status: number, statusText: string, body: string) {
    super(`GitHub API error: ${status} ${statusText}`);
    this.name = "GitHubHttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
  }
}

function parseCsvSet(value?: string): Set<string> | null {
  if (!value) return null;
  const values = value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return values.length > 0 ? new Set(values) : null;
}

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

async function fetchUsageItems(token: string, enterpriseSlug: string, year: number, month: number): Promise<BillingUsageItem[]> {
  const usageUrl = `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(enterpriseSlug)}/settings/billing/premium_request/usage?year=${year}&month=${month}`;
  const usageRes = await fetch(usageUrl, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION,
    },
    next: { revalidate: 0 },
  });

  if (!usageRes.ok) {
    const body = await usageRes.text();
    throw new GitHubHttpError(usageRes.status, usageRes.statusText, body);
  }

  const billingData: BillingUsageResponse = await usageRes.json();
  return billingData.usageItems ?? [];
}

function usageMatchesFilters(
  item: BillingUsageItem,
  filters: {
    model: Set<string> | null;
    org: Set<string> | null;
    user: Set<string> | null;
    team: Set<string> | null;
  }
): boolean {
  if (filters.model && !filters.model.has((item.sku ?? "").toLowerCase())) return false;
  if (filters.org && !filters.org.has((item.organizationName ?? "").toLowerCase())) return false;
  if (filters.user && !filters.user.has((item.user ?? "").toLowerCase())) return false;
  if (filters.team && !filters.team.has((item.team ?? "").toLowerCase())) return false;
  return true;
}

export async function GET(request: NextRequest) {
  try {
    const { token, enterpriseSlug } = await getGitHubConfig();

    if (!token || !enterpriseSlug) {
      return NextResponse.json(
        { error: "GitHub token and enterprise slug must be configured in Settings." },
        { status: 400 }
      );
    }

    const sp = request.nextUrl.searchParams;
    const now = new Date();
    const parsed = querySchema.parse({
      year: sp.get("year") ?? undefined,
      month: sp.get("month") ?? undefined,
      model: sp.get("model") ?? undefined,
      org: sp.get("org") ?? undefined,
      user: sp.get("user") ?? undefined,
      team: sp.get("team") ?? undefined,
    });

    const year = parsed.year ?? now.getFullYear();
    const month = parsed.month ?? now.getMonth() + 1;

    // Server-side row-level scoping: a `developer` is forced to their own login
    // regardless of any client-supplied `user=`; admins (and open/shared-password
    // modes) keep cross-user access. Enforced here, never in the UI alone.
    const session = getIdentitySessionFromRequest(request);
    const scope = resolveUserScope(session, parsed.user ?? null);

    const selectedFilters = {
      model: parseCsvSet(parsed.model),
      org: parseCsvSet(parsed.org),
      user: scope.forced ? new Set([scope.user!]) : parseCsvSet(parsed.user),
      team: parseCsvSet(parsed.team),
    };

    // 1. Fetch current-month usage
    let usageItems: BillingUsageItem[] = [];
    try {
      usageItems = await fetchUsageItems(token, enterpriseSlug, year, month);
    } catch (err) {
      if (err instanceof GitHubHttpError) {
        console.error(`Premium billing API error: ${err.status}`, err.body);
        if (err.status === 403) {
          return NextResponse.json(
            { error: "Access denied. Your PAT may not have the required scopes. Please ensure it has: manage_billing:copilot (read) or manage_billing:enterprise (read). Update scopes at https://github.com/settings/tokens" },
            { status: 403 }
          );
        }
        if (err.status === 404) {
          return NextResponse.json(
            { error: "Enterprise not found. Please verify the enterprise slug in Settings and ensure your PAT has access." },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { error: `GitHub Premium Billing API error: ${err.status} ${err.statusText}` },
          { status: err.status }
        );
      }
      throw err;
    }

    // Scope live usage rows to the developer's own login so neither the filter
    // option lists nor the breakdowns can expose another user's data.
    if (scope.forced) {
      usageItems = usageItems.filter(
        (item) => (item.user ?? "").toLowerCase() === scope.user
      );
    }

    // 2. Fetch seat data for plan quotas (deduplicated by user — highest plan wins)
    const allSeats: SeatInfo[] = [];
    let page = 1;
    while (true) {
      const seatsUrl = `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(enterpriseSlug)}/copilot/billing/seats?per_page=100&page=${page}`;
      const seatsRes = await fetch(seatsUrl, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": API_VERSION,
        },
        next: { revalidate: 0 },
      });

      if (!seatsRes.ok) break;

      const seatsData: SeatsResponse = await seatsRes.json();
      allSeats.push(...seatsData.seats);
      if (seatsData.seats.length < 100) break;
      page++;
    }

    // Deduplicate by user login — highest plan wins (enterprise > business)
    const PLAN_TIER: Record<string, number> = { enterprise: 2, business: 1 };
    const userPlanMap = new Map<string, string>();
    for (const seat of allSeats) {
      const login = seat.assignee.login;
      const plan = seat.plan_type || "unknown";
      const currentPlan = userPlanMap.get(login);
      if (!currentPlan || (PLAN_TIER[plan] ?? 0) > (PLAN_TIER[currentPlan] ?? 0)) {
        userPlanMap.set(login, plan);
      }
    }

    const totalSeats = userPlanMap.size;
    const planCounts: Record<string, number> = {};
    for (const [, plan] of userPlanMap) {
      planCounts[plan] = (planCounts[plan] || 0) + 1;
    }

    // 3. Calculate included capacity
    let totalIncludedQuota = 0;
    for (const [plan, count] of Object.entries(planCounts)) {
      totalIncludedQuota += (PLAN_QUOTAS[plan] ?? 0) * count;
    }

    const filterOptions = {
          models: Array.from(new Set(usageItems.map((i) => i.sku).filter((v): v is string => Boolean(v)))).map(getModelDisplayName).sort((a, b) => a.localeCompare(b)),
      orgs: Array.from(new Set(usageItems.map((i) => i.organizationName).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b)),
      users: Array.from(new Set(usageItems.map((i) => i.user).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b)),
      teams: Array.from(new Set(usageItems.map((i) => i.team).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b)),
    };

    const filteredUsageItems = usageItems.filter((item) => usageMatchesFilters(item, selectedFilters));

    // 4. Aggregate filtered usage data
    let totalGrossQuantity = 0;
    let totalNetAmount = 0;
    let totalGrossAmount = 0;

    const perModelMap = new Map<string, { sku: string; grossQuantity: number; grossAmount: number; netAmount: number }>();
    const perUserMap = new Map<string, { user: string; grossQuantity: number; grossAmount: number; netAmount: number }>();
    const perOrgMap = new Map<string, { org: string; grossQuantity: number; grossAmount: number; netAmount: number }>();
    const perTeamMap = new Map<string, { team: string; grossQuantity: number; grossAmount: number; netAmount: number }>();
    const perDayMap = new Map<string, { date: string; grossQuantity: number; grossAmount: number; netAmount: number }>();

    for (const item of filteredUsageItems) {
      const qty = item.grossQuantity ?? 0;
      const gross = item.grossAmount ?? 0;
      const net = item.netAmount ?? 0;

      totalGrossQuantity += qty;
      totalGrossAmount += gross;
      totalNetAmount += net;

      if (item.sku) {
        const existing = perModelMap.get(item.sku) ?? { sku: item.sku, grossQuantity: 0, grossAmount: 0, netAmount: 0 };
        existing.grossQuantity += qty;
        existing.grossAmount += gross;
        existing.netAmount += net;
        perModelMap.set(item.sku, existing);
      }

      if (item.user) {
        const existing = perUserMap.get(item.user) ?? { user: item.user, grossQuantity: 0, grossAmount: 0, netAmount: 0 };
        existing.grossQuantity += qty;
        existing.grossAmount += gross;
        existing.netAmount += net;
        perUserMap.set(item.user, existing);
      }

      if (item.organizationName) {
        const existing = perOrgMap.get(item.organizationName) ?? { org: item.organizationName, grossQuantity: 0, grossAmount: 0, netAmount: 0 };
        existing.grossQuantity += qty;
        existing.grossAmount += gross;
        existing.netAmount += net;
        perOrgMap.set(item.organizationName, existing);
      }

      if (item.team) {
        const existing = perTeamMap.get(item.team) ?? { team: item.team, grossQuantity: 0, grossAmount: 0, netAmount: 0 };
        existing.grossQuantity += qty;
        existing.grossAmount += gross;
        existing.netAmount += net;
        perTeamMap.set(item.team, existing);
      }

      if (item.date) {
        const existing = perDayMap.get(item.date) ?? { date: item.date, grossQuantity: 0, grossAmount: 0, netAmount: 0 };
        existing.grossQuantity += qty;
        existing.grossAmount += gross;
        existing.netAmount += net;
        perDayMap.set(item.date, existing);
      }
    }

    // 5. Calculate included vs overage
    const includedUsed = Math.min(totalGrossQuantity, totalIncludedQuota);
    const overage = Math.max(0, totalGrossQuantity - totalIncludedQuota);

    // 6. Resolve display names for users
    const userLogins = Array.from(new Set([...perUserMap.keys(), ...filterOptions.users]));
    const displayNameMap = await resolveDisplayNames(userLogins, token);

    const perModelBreakdown = Array.from(perModelMap.values())
      .map((m) => ({ ...m, sku: getModelDisplayName(m.sku) }))
      .sort((a, b) => b.grossQuantity - a.grossQuantity);
    const perUserBreakdown = Array.from(perUserMap.values())
      .map((u) => ({
        ...u,
        displayLabel: formatUserLabel(u.user, displayNameMap),
      }))
      .sort((a, b) => b.grossQuantity - a.grossQuantity);
    const perOrgBreakdown = Array.from(perOrgMap.values())
      .sort((a, b) => b.grossQuantity - a.grossQuantity);
    const perTeamBreakdown = Array.from(perTeamMap.values())
      .sort((a, b) => b.grossQuantity - a.grossQuantity);
    const dailyTrend = Array.from(perDayMap.values())
      .sort((a, b) => a.date.localeCompare(b.date));

    // 7. Build monthly trend (selected + previous 5 months) and period-over-period deltas.
    const monthPoints = Array.from({ length: 6 }, (_, idx) => shiftMonth(year, month, idx - 5));
    const monthlyTrend = await Promise.all(
      monthPoints.map(async (point) => {
        let monthItems: BillingUsageItem[] = [];
        try {
          monthItems =
            point.year === year && point.month === month
              ? usageItems
              : await fetchUsageItems(token, enterpriseSlug, point.year, point.month);
        } catch {
          monthItems = [];
        }

        const filtered = monthItems.filter((item) => usageMatchesFilters(item, selectedFilters));
        const requests = filtered.reduce((sum, i) => sum + (i.grossQuantity ?? 0), 0);
        const grossAmount = filtered.reduce((sum, i) => sum + (i.grossAmount ?? 0), 0);
        const netAmount = filtered.reduce((sum, i) => sum + (i.netAmount ?? 0), 0);

        return {
          year: point.year,
          month: point.month,
          label: `${point.year}-${String(point.month).padStart(2, "0")}`,
          requests,
          grossAmount: Math.round(grossAmount * 100) / 100,
          netAmount: Math.round(netAmount * 100) / 100,
        };
      })
    );

    const currentTrendPoint = monthlyTrend[monthlyTrend.length - 1];
    const previousTrendPoint = monthlyTrend[monthlyTrend.length - 2] ?? null;
    const changeVsPrevious = previousTrendPoint
      ? {
        requestsDelta: currentTrendPoint.requests - previousTrendPoint.requests,
        requestsDeltaPct: previousTrendPoint.requests > 0
          ? Math.round(((currentTrendPoint.requests - previousTrendPoint.requests) / previousTrendPoint.requests) * 100)
          : null,
        netAmountDelta: Math.round((currentTrendPoint.netAmount - previousTrendPoint.netAmount) * 100) / 100,
        netAmountDeltaPct: previousTrendPoint.netAmount > 0
          ? Math.round(((currentTrendPoint.netAmount - previousTrendPoint.netAmount) / previousTrendPoint.netAmount) * 100)
          : null,
      }
      : null;

    return NextResponse.json({
      period: { year, month },
      totals: {
        totalPremiumRequests: totalGrossQuantity,
        includedQuota: totalIncludedQuota,
        includedUsed,
        overage,
        grossAmount: Math.round(totalGrossAmount * 100) / 100,
        netAmount: Math.round(totalNetAmount * 100) / 100,
      },
      seats: {
        total: totalSeats,
        planCounts,
      },
      filters: {
        options: {
          models: filterOptions.models,
          orgs: filterOptions.orgs,
          users: filterOptions.users.map((login) => ({
            login,
            displayLabel: formatUserLabel(login, displayNameMap),
          })),
          teams: filterOptions.teams,
        },
        selected: {
          model: parsed.model ?? "",
          org: parsed.org ?? "",
          user: scope.forced ? scope.user! : (parsed.user ?? ""),
          team: parsed.team ?? "",
        },
      },
      perModelBreakdown,
      perUserBreakdown,
      perOrgBreakdown,
      perTeamBreakdown,
      dailyTrend,
      monthlyTrend,
      changeVsPrevious,
    });
  } catch (err) {
    console.error("Premium requests API error:", err);
    return NextResponse.json({ error: safeErrorMessage(err, "Internal server error") }, { status: 500 });
  }
}
