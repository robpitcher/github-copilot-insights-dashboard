import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { factAiCreditUsage } from "./schema";

/**
 * A single normalized AI Credit usage line item, derived from the GitHub
 * `/settings/billing/ai_credit/usage` endpoint response. Optional dimensions
 * (date, org, user, team, cost center) are populated only when the API returns
 * enriched, non-aggregated line items.
 */
export interface NormalizedAiCreditItem {
  usageDate: string | null;
  product: string;
  sku: string;
  model: string;
  costCenter: string | null;
  orgName: string | null;
  userLogin: string | null;
  teamName: string | null;
  unitType: string;
  pricePerUnit: number;
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

export interface AiCreditMonthlyTotal {
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

/** Build the `${year}-${month}` key used for monthly trend lookups. */
export function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * Persist a per-period snapshot of AI Credit usage. Existing rows for the same
 * enterprise/year/month are replaced so the snapshot always reflects the latest
 * API response. Best-effort: failures (e.g. DB unavailable) are swallowed so the
 * live report keeps working.
 */
export async function persistAiCreditSnapshot(
  enterpriseSlug: string,
  year: number,
  month: number,
  items: NormalizedAiCreditItem[]
): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx
        .delete(factAiCreditUsage)
        .where(
          and(
            eq(factAiCreditUsage.enterpriseSlug, enterpriseSlug),
            eq(factAiCreditUsage.periodYear, year),
            eq(factAiCreditUsage.periodMonth, month)
          )
        );

      if (items.length === 0) return;

      const rows = items.map((item) => ({
        enterpriseSlug,
        periodYear: year,
        periodMonth: month,
        usageDate: item.usageDate,
        product: item.product || "Copilot",
        sku: item.sku || "",
        model: item.model || "",
        costCenter: item.costCenter,
        orgName: item.orgName,
        userLogin: item.userLogin,
        teamName: item.teamName,
        unitType: item.unitType || "ai-credits",
        pricePerUnit: String(item.pricePerUnit ?? 0),
        grossQuantity: String(item.grossQuantity ?? 0),
        discountQuantity: String(item.discountQuantity ?? 0),
        netQuantity: String(item.netQuantity ?? 0),
        grossAmount: String(item.grossAmount ?? 0),
        discountAmount: String(item.discountAmount ?? 0),
        netAmount: String(item.netAmount ?? 0),
      }));

      // Insert in batches to stay within parameter limits.
      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        await tx.insert(factAiCreditUsage).values(rows.slice(i, i + BATCH));
      }
    });
  } catch (err) {
    console.warn("persistAiCreditSnapshot failed (continuing live-only):", err);
  }
}

/**
 * Read monthly AI Credit totals for the given periods from the persisted
 * snapshots. Returns a map keyed by `${year}-${month}`; months with no stored
 * data are omitted so callers can fall back to a live API fetch.
 * Best-effort: returns an empty map on failure.
 */
export async function getAiCreditMonthlyTotalsFromDb(
  enterpriseSlug: string,
  points: Array<{ year: number; month: number }>
): Promise<Map<string, AiCreditMonthlyTotal>> {
  const result = new Map<string, AiCreditMonthlyTotal>();
  if (points.length === 0) return result;

  try {
    const rows = await db
      .select({
        periodYear: factAiCreditUsage.periodYear,
        periodMonth: factAiCreditUsage.periodMonth,
        grossQuantity: factAiCreditUsage.grossQuantity,
        discountQuantity: factAiCreditUsage.discountQuantity,
        netQuantity: factAiCreditUsage.netQuantity,
        grossAmount: factAiCreditUsage.grossAmount,
        discountAmount: factAiCreditUsage.discountAmount,
        netAmount: factAiCreditUsage.netAmount,
      })
      .from(factAiCreditUsage)
      .where(eq(factAiCreditUsage.enterpriseSlug, enterpriseSlug));

    const wanted = new Set(points.map((p) => monthKey(p.year, p.month)));
    for (const row of rows) {
      const key = monthKey(row.periodYear, row.periodMonth);
      if (!wanted.has(key)) continue;
      const acc =
        result.get(key) ?? {
          grossQuantity: 0,
          discountQuantity: 0,
          netQuantity: 0,
          grossAmount: 0,
          discountAmount: 0,
          netAmount: 0,
        };
      acc.grossQuantity += Number(row.grossQuantity);
      acc.discountQuantity += Number(row.discountQuantity);
      acc.netQuantity += Number(row.netQuantity);
      acc.grossAmount += Number(row.grossAmount);
      acc.discountAmount += Number(row.discountAmount);
      acc.netAmount += Number(row.netAmount);
      result.set(key, acc);
    }
  } catch (err) {
    console.warn("getAiCreditMonthlyTotalsFromDb failed (using live API):", err);
  }

  return result;
}

/** Convert a persisted fact row into the shared normalized item shape. */
function rowToNormalizedItem(row: {
  usageDate: string | null;
  product: string;
  sku: string;
  model: string;
  costCenter: string | null;
  orgName: string | null;
  userLogin: string | null;
  teamName: string | null;
  unitType: string;
  pricePerUnit: string;
  grossQuantity: string;
  discountQuantity: string;
  netQuantity: string;
  grossAmount: string;
  discountAmount: string;
  netAmount: string;
}): NormalizedAiCreditItem {
  return {
    usageDate: row.usageDate,
    product: row.product,
    sku: row.sku,
    model: row.model,
    costCenter: row.costCenter,
    orgName: row.orgName,
    userLogin: row.userLogin,
    teamName: row.teamName,
    unitType: row.unitType,
    pricePerUnit: Number(row.pricePerUnit),
    grossQuantity: Number(row.grossQuantity),
    discountQuantity: Number(row.discountQuantity),
    netQuantity: Number(row.netQuantity),
    grossAmount: Number(row.grossAmount),
    discountAmount: Number(row.discountAmount),
    netAmount: Number(row.netAmount),
  };
}

const itemColumns = {
  periodYear: factAiCreditUsage.periodYear,
  periodMonth: factAiCreditUsage.periodMonth,
  usageDate: factAiCreditUsage.usageDate,
  product: factAiCreditUsage.product,
  sku: factAiCreditUsage.sku,
  model: factAiCreditUsage.model,
  costCenter: factAiCreditUsage.costCenter,
  orgName: factAiCreditUsage.orgName,
  userLogin: factAiCreditUsage.userLogin,
  teamName: factAiCreditUsage.teamName,
  unitType: factAiCreditUsage.unitType,
  pricePerUnit: factAiCreditUsage.pricePerUnit,
  grossQuantity: factAiCreditUsage.grossQuantity,
  discountQuantity: factAiCreditUsage.discountQuantity,
  netQuantity: factAiCreditUsage.netQuantity,
  grossAmount: factAiCreditUsage.grossAmount,
  discountAmount: factAiCreditUsage.discountAmount,
  netAmount: factAiCreditUsage.netAmount,
} as const;

/**
 * Read persisted AI Credit line items for the given periods, bucketed by
 * `${year}-${month}`. When `userScope` is provided, only that user's rows are
 * returned — the row-level guard that prevents a developer from ever reading
 * another user's data. Comparison against stored `user_login` is
 * case-insensitive. Best-effort: returns an empty map on failure.
 */
export async function getAiCreditItemsByMonthFromDb(
  enterpriseSlug: string,
  points: Array<{ year: number; month: number }>,
  userScope?: string | null
): Promise<Map<string, NormalizedAiCreditItem[]>> {
  const result = new Map<string, NormalizedAiCreditItem[]>();
  if (points.length === 0) return result;

  const wanted = new Set(points.map((p) => monthKey(p.year, p.month)));
  const scope = userScope ? userScope.toLowerCase() : null;

  try {
    const rows = await db
      .select(itemColumns)
      .from(factAiCreditUsage)
      .where(eq(factAiCreditUsage.enterpriseSlug, enterpriseSlug));

    for (const row of rows) {
      const key = monthKey(row.periodYear, row.periodMonth);
      if (!wanted.has(key)) continue;
      if (scope && (row.userLogin ?? "").toLowerCase() !== scope) continue;
      const bucket = result.get(key) ?? [];
      bucket.push(rowToNormalizedItem(row));
      result.set(key, bucket);
    }
  } catch (err) {
    console.warn("getAiCreditItemsByMonthFromDb failed:", err);
  }

  return result;
}

