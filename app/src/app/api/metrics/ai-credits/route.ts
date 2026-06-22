import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getGitHubConfig } from "@/lib/db/settings";
import { resolveDisplayNames, formatUserLabel } from "@/lib/github/resolve-display-names";
import { getModelDisplayName } from "@/lib/utils/model-display-names";
import { safeErrorMessage } from "@/lib/auth";
import {
  persistAiCreditSnapshot,
  getAiCreditMonthlyTotalsFromDb,
  monthKey,
  type NormalizedAiCreditItem,
} from "@/lib/db/ai-credit-usage";
import { getCreditConsumption } from "@/lib/db/ai-credit-consumption";

export const dynamic = "force-dynamic";

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";

/**
 * Raw AI Credit usage item as returned by
 * `/enterprises/{enterprise}/settings/billing/ai_credit/usage`.
 * The aggregated form keys on (model, sku); enriched line items may also carry
 * date / organization / user / team / cost-center dimensions.
 */
interface AiCreditUsageItem {
  product?: string;
  sku?: string;
  model?: string;
  unitType?: string;
  unitTypeString?: string;
  pricePerUnit?: number;
  grossQuantity?: number;
  grossAmount?: number;
  discountQuantity?: number;
  discountAmount?: number;
  netQuantity?: number;
  netAmount?: number;
  // Optional dimensions present on enriched (non-aggregated) responses.
  date?: string;
  organizationName?: string;
  user?: string;
  team?: string;
  costCenterName?: string;
  costCenter?: string;
}

interface AiCreditUsageResponse {
  timePeriod?: { year: number; month: number };
  enterprise?: string;
  usageItems: AiCreditUsageItem[];
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
  costCenter: z.string().optional(),
  userId: z.string().optional(),
  orgId: z.string().optional(),
  teamId: z.string().optional(),
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

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Per-seat monthly included AI Credit entitlement (USD) under usage-based
 * billing, as published in the GitHub announcement:
 * https://github.blog/news-insights/company-news/github-copilot-is-moving-to-usage-based-billing/
 *
 * Base entitlement matches each plan's seat price. Existing Copilot Business and
 * Copilot Enterprise customers receive a higher *promotional* included amount
 * for June, July, and August 2026.
 */
const INCLUDED_CREDIT_PER_SEAT = {
  base: { business: 19, enterprise: 39 },
  promotional: { business: 30, enterprise: 70 },
} as const;

/** Promotional window (year 2026, months June–August) for businesses/enterprises. */
const PROMO_YEAR = 2026;
const PROMO_MONTHS = new Set([6, 7, 8]);
const PROMO_PERIOD_LABEL = "June–August 2026";

function isPromotionalPeriod(year: number, month: number): boolean {
  return year === PROMO_YEAR && PROMO_MONTHS.has(month);
}

/**
 * Derive the included AI Credit pool (entitlement) from seat counts and the
 * selected period. GitHub does not (yet) expose a dedicated live endpoint for
 * the pool total, so it is computed per seat type from the published rates and
 * the pooled-included-usage model described in the announcement above.
 */
function computeCreditPool(
  planCounts: Record<string, number>,
  year: number,
  month: number
) {
  const promotional = isPromotionalPeriod(year, month);
  const rates = promotional
    ? INCLUDED_CREDIT_PER_SEAT.promotional
    : INCLUDED_CREDIT_PER_SEAT.base;
  const businessSeats = planCounts.business ?? 0;
  const enterpriseSeats = planCounts.enterprise ?? 0;
  const total = businessSeats * rates.business + enterpriseSeats * rates.enterprise;
  return {
    total: round2(total),
    promotional,
    promotionalPeriod: promotional ? PROMO_PERIOD_LABEL : null,
    perSeat: { business: rates.business, enterprise: rates.enterprise },
    seats: { business: businessSeats, enterprise: enterpriseSeats },
  };
}

/** Normalize a raw API item into the shared snapshot shape. */
function normalizeItem(item: AiCreditUsageItem): NormalizedAiCreditItem {
  return {
    usageDate: item.date ?? null,
    product: item.product ?? "Copilot",
    sku: item.sku ?? "",
    model: item.model ?? item.sku ?? "",
    costCenter: item.costCenterName ?? item.costCenter ?? null,
    orgName: item.organizationName ?? null,
    userLogin: item.user ?? null,
    teamName: item.team ?? null,
    unitType: item.unitTypeString ?? item.unitType ?? "ai-credits",
    pricePerUnit: num(item.pricePerUnit),
    grossQuantity: num(item.grossQuantity),
    discountQuantity: num(item.discountQuantity),
    netQuantity: num(item.netQuantity),
    grossAmount: num(item.grossAmount),
    discountAmount: num(item.discountAmount),
    netAmount: num(item.netAmount),
  };
}

async function fetchUsageItems(
  token: string,
  enterpriseSlug: string,
  year: number,
  month: number
): Promise<NormalizedAiCreditItem[]> {
  const usageUrl = `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(enterpriseSlug)}/settings/billing/ai_credit/usage?year=${year}&month=${month}`;
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

  const data: AiCreditUsageResponse = await usageRes.json();
  return (data.usageItems ?? []).map(normalizeItem);
}

interface MatchFilters {
  model: Set<string> | null;
  costCenter: Set<string> | null;
}

// Billing usage items only carry model / SKU / cost-center (and sometimes org)
// dimensions — never per-user or per-team. The user / team / org filters are
// served by the DB consumption layer instead, so billing is filtered on the two
// dimensions it reliably provides. This also avoids zeroing the cost view when a
// dimension the billing feed lacks is selected.
function usageMatchesFilters(item: NormalizedAiCreditItem, filters: MatchFilters): boolean {
  if (filters.model && !filters.model.has((item.model ?? "").toLowerCase())) return false;
  if (filters.costCenter && !filters.costCenter.has((item.costCenter ?? "").toLowerCase())) return false;
  return true;
}

interface CreditBucket {
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

function emptyBucket(): CreditBucket {
  return {
    grossQuantity: 0,
    discountQuantity: 0,
    netQuantity: 0,
    grossAmount: 0,
    discountAmount: 0,
    netAmount: 0,
  };
}

function addToBucket(bucket: CreditBucket, item: NormalizedAiCreditItem): void {
  bucket.grossQuantity += item.grossQuantity;
  bucket.discountQuantity += item.discountQuantity;
  bucket.netQuantity += item.netQuantity;
  bucket.grossAmount += item.grossAmount;
  bucket.discountAmount += item.discountAmount;
  bucket.netAmount += item.netAmount;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function roundBucketAmounts(bucket: CreditBucket): CreditBucket {
  return {
    grossQuantity: Math.round(bucket.grossQuantity * 100) / 100,
    discountQuantity: Math.round(bucket.discountQuantity * 100) / 100,
    netQuantity: Math.round(bucket.netQuantity * 100) / 100,
    grossAmount: round2(bucket.grossAmount),
    discountAmount: round2(bucket.discountAmount),
    netAmount: round2(bucket.netAmount),
  };
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
      costCenter: sp.get("costCenter") ?? undefined,
      userId: sp.get("userId") ?? undefined,
      orgId: sp.get("orgId") ?? undefined,
      teamId: sp.get("teamId") ?? undefined,
    });

    const year = parsed.year ?? now.getFullYear();
    const month = parsed.month ?? now.getMonth() + 1;

    const selectedFilters: MatchFilters = {
      model: parseCsvSet(parsed.model),
      costCenter: parseCsvSet(parsed.costCenter),
    };

    // 1. Fetch selected-month AI Credit usage.
    let usageItems: NormalizedAiCreditItem[] = [];
    try {
      usageItems = await fetchUsageItems(token, enterpriseSlug, year, month);
    } catch (err) {
      if (err instanceof GitHubHttpError) {
        console.error(`AI Credit billing API error: ${err.status}`, err.body);
        if (err.status === 403) {
          return NextResponse.json(
            { error: "Access denied. Your PAT may not have the required scopes. Please ensure it has: manage_billing:copilot (read) or manage_billing:enterprise (read). Update scopes at https://github.com/settings/tokens" },
            { status: 403 }
          );
        }
        if (err.status === 404) {
          return NextResponse.json(
            { error: "Enterprise not found, or AI Credit usage is not yet available for this period (the ai_credit/usage endpoint only returns activity after June 1, 2026). Verify the enterprise slug in Settings." },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { error: `GitHub AI Credit Billing API error: ${err.status} ${err.statusText}` },
          { status: err.status }
        );
      }
      throw err;
    }

    // Persist this month's snapshot (best-effort) for trend continuity.
    await persistAiCreditSnapshot(enterpriseSlug, year, month, usageItems);

    // 2. Fetch seat data for "credits per seat" context (deduped, highest plan wins).
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

    // 3. Billing filter option lists (from unfiltered items). User / team / org
    // options are sourced from the DB consumption layer instead (see below).
    const filterOptions = {
      models: Array.from(new Set(usageItems.map((i) => i.model).filter((v): v is string => Boolean(v)))).sort((a, b) => getModelDisplayName(a).localeCompare(getModelDisplayName(b))),
      costCenters: Array.from(new Set(usageItems.map((i) => i.costCenter).filter((v): v is string => Boolean(v)))).sort((a, b) => a.localeCompare(b)),
    };

    const filteredItems = usageItems.filter((item) => usageMatchesFilters(item, selectedFilters));

    // 4. Aggregate filtered usage.
    const totals = emptyBucket();
    const perModelMap = new Map<string, CreditBucket>();
    const perSkuMap = new Map<string, CreditBucket>();
    const perUserMap = new Map<string, CreditBucket>();
    const perOrgMap = new Map<string, CreditBucket>();
    const perTeamMap = new Map<string, CreditBucket>();
    const perCostCenterMap = new Map<string, CreditBucket>();
    const perDayMap = new Map<string, CreditBucket>();

    const accumulate = (map: Map<string, CreditBucket>, key: string | null, item: NormalizedAiCreditItem) => {
      if (!key) return;
      const bucket = map.get(key) ?? emptyBucket();
      addToBucket(bucket, item);
      map.set(key, bucket);
    };

    for (const item of filteredItems) {
      addToBucket(totals, item);
      accumulate(perModelMap, item.model || null, item);
      accumulate(perSkuMap, item.sku || null, item);
      accumulate(perUserMap, item.userLogin, item);
      accumulate(perOrgMap, item.orgName, item);
      accumulate(perTeamMap, item.teamName, item);
      accumulate(perCostCenterMap, item.costCenter, item);
      accumulate(perDayMap, item.usageDate, item);
    }

    const toBreakdown = <K extends string>(
      map: Map<string, CreditBucket>,
      keyName: K
    ): Array<Record<K, string> & CreditBucket> =>
      Array.from(map.entries())
        .map(([key, bucket]) => ({ [keyName]: key, ...roundBucketAmounts(bucket) }) as Record<K, string> & CreditBucket)
        .sort((a, b) => b.grossQuantity - a.grossQuantity);

    const perModelBreakdown = toBreakdown(perModelMap, "model").map((m) => ({ ...m, model: getModelDisplayName(m.model) }));
    const perSkuBreakdown = toBreakdown(perSkuMap, "sku");
    const perOrgBreakdown = toBreakdown(perOrgMap, "org");
    const perTeamBreakdown = toBreakdown(perTeamMap, "team");
    const perCostCenterBreakdown = toBreakdown(perCostCenterMap, "costCenter");

    // Per-user / per-team / per-org AI credit consumption from the usage-metrics
    // signal (fact_copilot_usage_daily.ai_credits_used). This also drives the
    // user / team / org filters, which the billing feed cannot populate.
    const windowStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const windowEnd = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    const consumption = await getCreditConsumption(windowStart, windowEnd, {
      userIds: (parsed.userId ?? "")
        .split(",")
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n)),
      orgId: parsed.orgId,
      teamId: parsed.teamId,
    });

    // Resolve display names for every login surfaced in the response: the
    // rendered breakdown rows (billing + consumption) and the user filter
    // options. This mirrors the shared /api/filters behaviour so dropdown
    // entries with no usage in the window still show "Name (login)" rather than
    // falling back to the bare login. resolveDisplayNames dedupes and batches.
    const userLogins = Array.from(
      new Set([
        ...perUserMap.keys(),
        ...consumption.perUser.map((u) => u.userLogin),
        ...consumption.options.users.map((u) => u.userLogin),
      ]),
    );
    const displayNameMap = await resolveDisplayNames(userLogins, token);
    const perUserBreakdown = Array.from(perUserMap.entries())
      .map(([user, bucket]) => ({ user, displayLabel: formatUserLabel(user, displayNameMap), ...roundBucketAmounts(bucket) }))
      .sort((a, b) => b.grossQuantity - a.grossQuantity);

    const dailyTrend = Array.from(perDayMap.entries())
      .map(([date, bucket]) => ({ date, ...roundBucketAmounts(bucket) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // 5. Headline AI-credit metrics.
    const grossCredits = totals.grossQuantity;
    const includedCredits = totals.discountQuantity; // covered by entitlement
    const billableCredits = totals.netQuantity;
    const discountCoveragePct = grossCredits > 0 ? Math.round((includedCredits / grossCredits) * 100) : 0;
    const effectivePricePerCredit = grossCredits > 0 ? round2(totals.grossAmount / grossCredits) : 0;

    // Included AI Credit pool (entitlement) derived from seat mix + period rates.
    const poolBase = computeCreditPool(planCounts, year, month);
    const poolConsumedAmount = round2(totals.discountAmount);
    const creditPool = {
      ...poolBase,
      consumedAmount: poolConsumedAmount,
      remainingAmount: round2(Math.max(0, poolBase.total - poolConsumedAmount)),
      utilizationPct:
        poolBase.total > 0 ? Math.round((poolConsumedAmount / poolBase.total) * 100) : 0,
    };

    // 6. Trailing 6-month trend — DB snapshots first, live API fallback per month.
    const monthPoints = Array.from({ length: 6 }, (_, idx) => shiftMonth(year, month, idx - 5));
    const dbTotals = await getAiCreditMonthlyTotalsFromDb(enterpriseSlug, monthPoints);
    const hasActiveFilters = Object.values(selectedFilters).some((f) => f !== null);

    const monthlyTrend = await Promise.all(
      monthPoints.map(async (point) => {
        const key = monthKey(point.year, point.month);
        const isCurrent = point.year === year && point.month === month;

        let bucket: CreditBucket | null = null;
        if (isCurrent) {
          bucket = totals;
        } else if (!hasActiveFilters && dbTotals.has(key)) {
          // Snapshots store unfiltered totals; only use them when no filter is applied.
          bucket = dbTotals.get(key)!;
        } else {
          try {
            const monthItems = await fetchUsageItems(token, enterpriseSlug, point.year, point.month);
            const filtered = monthItems.filter((item) => usageMatchesFilters(item, selectedFilters));
            const b = emptyBucket();
            for (const item of filtered) addToBucket(b, item);
            bucket = b;
          } catch {
            bucket = emptyBucket();
          }
        }

        return {
          year: point.year,
          month: point.month,
          label: key,
          grossCredits: Math.round(bucket.grossQuantity),
          billableCredits: Math.round(bucket.netQuantity),
          grossAmount: round2(bucket.grossAmount),
          netAmount: round2(bucket.netAmount),
        };
      })
    );

    const currentTrendPoint = monthlyTrend[monthlyTrend.length - 1];
    const previousTrendPoint = monthlyTrend[monthlyTrend.length - 2] ?? null;
    const changeVsPrevious = previousTrendPoint
      ? {
          creditsDelta: currentTrendPoint.grossCredits - previousTrendPoint.grossCredits,
          creditsDeltaPct: previousTrendPoint.grossCredits > 0
            ? Math.round(((currentTrendPoint.grossCredits - previousTrendPoint.grossCredits) / previousTrendPoint.grossCredits) * 100)
            : null,
          netAmountDelta: round2(currentTrendPoint.netAmount - previousTrendPoint.netAmount),
          netAmountDeltaPct: previousTrendPoint.netAmount > 0
            ? Math.round(((currentTrendPoint.netAmount - previousTrendPoint.netAmount) / previousTrendPoint.netAmount) * 100)
            : null,
        }
      : null;

    return NextResponse.json({
      period: { year, month },
      unitType: "ai-credits",
      totals: {
        grossCredits: round2(grossCredits),
        includedCredits: round2(includedCredits),
        billableCredits: round2(billableCredits),
        grossAmount: round2(totals.grossAmount),
        discountAmount: round2(totals.discountAmount),
        netAmount: round2(totals.netAmount),
        discountCoveragePct,
        effectivePricePerCredit,
      },
      seats: {
        total: totalSeats,
        planCounts,
      },
      creditPool,
      filters: {
        options: {
          models: filterOptions.models.map((value) => ({ value, label: getModelDisplayName(value) })),
          costCenters: filterOptions.costCenters,
          users: consumption.options.users.map((u) => ({
            userId: u.userId,
            displayLabel: formatUserLabel(u.userLogin, displayNameMap),
          })),
          orgs: consumption.options.orgs,
          teams: consumption.options.teams,
        },
        selected: {
          model: parsed.model ?? "",
          costCenter: parsed.costCenter ?? "",
          userId: parsed.userId ?? "",
          orgId: parsed.orgId ?? "",
          teamId: parsed.teamId ?? "",
        },
      },
      perModelBreakdown,
      perSkuBreakdown,
      perUserBreakdown,
      perOrgBreakdown,
      perTeamBreakdown,
      perCostCenterBreakdown,
      dailyTrend,
      monthlyTrend,
      changeVsPrevious,
      creditConsumption: {
        available: consumption.available,
        totalCreditsUsed: consumption.totalCreditsUsed,
        activeUsers: consumption.activeUsers,
        perUser: consumption.perUser.map((u) => ({
          userId: u.userId,
          userLogin: u.userLogin,
          displayLabel: formatUserLabel(u.userLogin, displayNameMap),
          creditsUsed: u.creditsUsed,
          daysActive: u.daysActive,
        })),
        perOrg: consumption.perOrg,
        perTeam: consumption.perTeam,
      },
    });
  } catch (err) {
    console.error("AI credits API error:", err);
    return NextResponse.json({ error: safeErrorMessage(err, "Internal server error") }, { status: 500 });
  }
}
