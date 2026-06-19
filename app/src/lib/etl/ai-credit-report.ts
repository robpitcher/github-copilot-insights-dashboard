/**
 * AI Credit usage ingestion via the GitHub enterprise async **report export**.
 *
 * Flow (per the self-service epic, issue C1):
 *   1. `POST /enterprises/{enterprise}/settings/billing/reports` with
 *      `report_type: ai_credit` and a `[start_date, end_date]` window.
 *   2. Poll the returned report resource until it completes.
 *   3. Download the signed CSV(s) from `download_urls` (short-lived secrets —
 *      downloaded immediately, never persisted or logged).
 *   4. Parse the CSV (grouped by `date × model × username`, with credits + USD),
 *      normalize rows (lowercased `user_login`), and persist per calendar month
 *      to `fact_ai_credit_usage` using the existing delete+reinsert snapshot
 *      semantics so month-to-date refreshes stay idempotent.
 *
 * Ingestion runs on the existing in-process scheduler for now; issue C2 moves it
 * to a dedicated Container Apps cron Job. Because the scheduler runs on every
 * replica, a best-effort cross-replica lock (a TTL'd `app_settings` row) plus an
 * in-process flag guard against concurrent report creation until C2 lands.
 *
 * A per-user `?user=` live-usage path is kept purely as a diagnostic fallback.
 */

import {
  persistAiCreditSnapshot,
  type NormalizedAiCreditItem,
} from "@/lib/db/ai-credit-usage";
import { getSetting, setSetting, deleteSetting } from "@/lib/db/settings";
import { randomUUID } from "node:crypto";

const GITHUB_API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";

/** Largest report window GitHub accepts per request; longer ranges are split. */
const MAX_WINDOW_DAYS = 31;

/** Default poll cadence and ceiling while waiting for a report to complete. */
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 60; // ~5 minutes

/** Cross-replica ingest lock (transitional — removed when C2 lands). */
const INGEST_LOCK_KEY = "ai_credit_ingest_lock";
const INGEST_LOCK_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** In-process guard so a single replica never starts two runs at once. */
let inProgress = false;

export interface IngestAiCreditOptions {
  token: string;
  enterpriseSlug: string;
  /** Inclusive window start (YYYY-MM-DD). Defaults to first-of-month UTC. */
  startDate?: string;
  /** Inclusive window end (YYYY-MM-DD). Defaults to yesterday UTC. */
  endDate?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

export interface IngestAiCreditResult {
  rowsPersisted: number;
  monthsPersisted: number;
  windowsProcessed: number;
}

/* ── Date helpers ── */

function toIsoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

/** First day of the current month, in UTC. */
export function firstOfMonthUtc(now = new Date()): string {
  return toIsoDate(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}

/** Yesterday, in UTC. */
export function yesterdayUtc(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - 1);
  return toIsoDate(d);
}

/**
 * Split an inclusive `[start, end]` window into chunks no longer than
 * `MAX_WINDOW_DAYS`, broken on calendar-month boundaries so each chunk maps to a
 * single `(year, month)` snapshot.
 */
export function splitWindows(
  start: string,
  end: string
): Array<{ start: string; end: string }> {
  const windows: Array<{ start: string; end: string }> = [];
  let cursor = new Date(`${start}T00:00:00Z`);
  const endDate = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(endDate.getTime()) || cursor > endDate) {
    return windows;
  }

  while (cursor <= endDate) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    let chunkEnd = monthEnd < endDate ? monthEnd : endDate;

    // Enforce the hard window cap within a month as well.
    const maxEnd = new Date(cursor);
    maxEnd.setUTCDate(maxEnd.getUTCDate() + MAX_WINDOW_DAYS - 1);
    if (maxEnd < chunkEnd) chunkEnd = maxEnd;

    windows.push({ start: toIsoDate(cursor), end: toIsoDate(chunkEnd) });

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return windows;
}

/* ── CSV parsing ── */

/** Parse a single RFC4180-style CSV line, honoring quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Canonicalize a header cell to `snake_case` for alias matching. */
function canonicalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Map a canonical header to a normalized field, or null when unrecognized. */
function fieldForHeader(header: string): keyof NormalizedAiCreditItem | "quantity" | null {
  switch (header) {
    case "date":
    case "usage_date":
    case "day":
      return "usageDate";
    case "username":
    case "user":
    case "user_login":
    case "user_name":
    case "login":
      return "userLogin";
    case "model":
      return "model";
    case "sku":
    case "product_sku":
      return "sku";
    case "product":
      return "product";
    case "organization":
    case "organization_name":
    case "org":
    case "org_name":
      return "orgName";
    case "team":
    case "team_name":
      return "teamName";
    case "cost_center":
    case "cost_center_name":
      return "costCenter";
    case "unit_type":
    case "unit_type_string":
      return "unitType";
    case "price_per_unit":
    case "unit_price":
      return "pricePerUnit";
    case "gross_quantity":
      return "grossQuantity";
    case "discount_quantity":
      return "discountQuantity";
    case "net_quantity":
    case "quantity":
    case "credits":
    case "net_credits":
      return "quantity";
    case "gross_amount":
      return "grossAmount";
    case "discount_amount":
      return "discountAmount";
    case "net_amount":
    case "amount":
      return "netAmount";
    default:
      return null;
  }
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : 0;
}

/**
 * Parse an `ai_credit` report CSV into normalized line items.
 *
 * - `user_login` is lowercased for consistent row-level scoping.
 * - A generic `quantity` / `credits` column maps to `netQuantity`; when no
 *   explicit `gross_quantity` column is present, `grossQuantity` mirrors it so
 *   downstream headline metrics stay meaningful. `grossAmount` mirrors
 *   `netAmount` likewise when not provided separately.
 */
export function parseAiCreditCsv(content: string): NormalizedAiCreditItem[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => fieldForHeader(canonicalizeHeader(h)));
  const items: NormalizedAiCreditItem[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const raw: Record<string, string> = {};
    headers.forEach((field, idx) => {
      if (field) raw[field] = cells[idx] ?? "";
    });

    const hasExplicitGrossQty = "grossQuantity" in raw;
    const hasExplicitGrossAmt = "grossAmount" in raw;
    const netQuantity = toNumber(raw.netQuantity ?? raw.quantity);
    const netAmount = toNumber(raw.netAmount);
    const userLogin = raw.userLogin?.trim() ? raw.userLogin.trim().toLowerCase() : null;

    items.push({
      usageDate: raw.usageDate?.trim() || null,
      product: raw.product?.trim() || "Copilot",
      sku: raw.sku?.trim() || "",
      model: raw.model?.trim() || raw.sku?.trim() || "",
      costCenter: raw.costCenter?.trim() || null,
      orgName: raw.orgName?.trim() || null,
      userLogin,
      teamName: raw.teamName?.trim() || null,
      unitType: raw.unitType?.trim() || "ai-credits",
      pricePerUnit: toNumber(raw.pricePerUnit),
      grossQuantity: hasExplicitGrossQty ? toNumber(raw.grossQuantity) : netQuantity,
      discountQuantity: toNumber(raw.discountQuantity),
      netQuantity,
      grossAmount: hasExplicitGrossAmt ? toNumber(raw.grossAmount) : netAmount,
      discountAmount: toNumber(raw.discountAmount),
      netAmount,
    });
  }

  return items;
}

/* ── Report export orchestration ── */

interface ReportResource {
  id?: string | number;
  report_id?: string | number;
  status?: string;
  state?: string;
  download_urls?: string[];
  download_url?: string;
  url?: string;
}

const COMPLETE_STATUSES = new Set(["completed", "complete", "finished", "succeeded", "done"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": API_VERSION,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reportId(resource: ReportResource): string | number | undefined {
  return resource.id ?? resource.report_id;
}

function downloadUrls(resource: ReportResource): string[] {
  if (Array.isArray(resource.download_urls)) return resource.download_urls;
  if (resource.download_url) return [resource.download_url];
  return [];
}

/**
 * Create one `ai_credit` report for a window, poll to completion and download +
 * parse its CSV(s). Returns the normalized rows. Signed download URLs are used
 * immediately and never persisted or logged.
 */
async function fetchWindowItems(
  opts: IngestAiCreditOptions,
  window: { start: string; end: string }
): Promise<NormalizedAiCreditItem[]> {
  const { token, enterpriseSlug } = opts;
  const base = `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(enterpriseSlug)}/settings/billing/reports`;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollAttempts = opts.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;

  console.info(
    `AI Credit report export requested (window: ${window.start} → ${window.end})`
  );

  const createRes = await fetch(base, {
    method: "POST",
    headers: { ...githubHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({
      report_type: "ai_credit",
      start_date: window.start,
      end_date: window.end,
    }),
  });

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    if (createRes.status === 403 || createRes.status === 404) {
      // The usage report export API enforces enterprise billing access. GitHub
      // masks a missing scope/role as a 404 (not 403) for billing resources, so
      // surface the actionable cause instead of a bare status code.
      throw new Error(
        `Failed to create ai_credit report: ${createRes.status} ${createRes.statusText}. ` +
          `This endpoint requires the classic PAT scope 'manage_billing:enterprise' (read) and an ` +
          `enterprise admin or billing manager role — GitHub returns 404 when the scope or permission ` +
          `is missing. Update scopes at https://github.com/settings/tokens. Details: ${body}`
      );
    }
    throw new Error(
      `Failed to create ai_credit report: ${createRes.status} ${createRes.statusText} ${body}`
    );
  }

  let resource: ReportResource = await createRes.json();
  let urls = downloadUrls(resource);
  let attempts = 0;

  while (urls.length === 0) {
    const status = (resource.status ?? resource.state ?? "").toLowerCase();
    if (FAILED_STATUSES.has(status)) {
      throw new Error(`ai_credit report export ${status} for window ${window.start} → ${window.end}`);
    }
    if (attempts >= maxPollAttempts) {
      throw new Error(
        `ai_credit report export timed out after ${attempts} polls (window ${window.start} → ${window.end})`
      );
    }

    await sleep(pollIntervalMs);
    attempts++;

    const id = reportId(resource);
    const pollUrl = resource.url ?? (id !== undefined ? `${base}/${encodeURIComponent(String(id))}` : null);
    if (!pollUrl) {
      throw new Error("ai_credit report export response missing id and poll url");
    }

    const pollRes = await fetch(pollUrl, { headers: githubHeaders(token) });
    if (!pollRes.ok) {
      const body = await pollRes.text().catch(() => "");
      throw new Error(`Failed to poll ai_credit report: ${pollRes.status} ${pollRes.statusText} ${body}`);
    }
    resource = await pollRes.json();
    urls = downloadUrls(resource);

    if (urls.length === 0 && COMPLETE_STATUSES.has((resource.status ?? resource.state ?? "").toLowerCase())) {
      // A completed report with no download URLs would silently persist nothing
      // while looking successful — treat it as a hard failure so the scheduler
      // logs an error and the run can be retried/investigated.
      throw new Error(
        `ai_credit report export completed without download URLs for window ${window.start} → ${window.end}`
      );
    }
  }

  // Download signed CSV(s) immediately. URLs are short-lived secrets — never logged.
  const items: NormalizedAiCreditItem[] = [];
  for (const url of urls) {
    const fileRes = await fetch(url);
    if (!fileRes.ok) {
      console.warn(`Failed to download ai_credit report CSV: ${fileRes.status} ${fileRes.statusText}`);
      continue;
    }
    const csv = await fileRes.text();
    items.push(...parseAiCreditCsv(csv));
  }

  console.info(`AI Credit report export parsed ${items.length} row(s) for window ${window.start} → ${window.end}`);
  return items;
}

/** Group normalized items by the calendar month of their `usageDate`. */
function groupByMonth(
  items: NormalizedAiCreditItem[]
): Map<string, { year: number; month: number; items: NormalizedAiCreditItem[] }> {
  const groups = new Map<string, { year: number; month: number; items: NormalizedAiCreditItem[] }>();
  for (const item of items) {
    if (!item.usageDate) continue;
    const [y, m] = item.usageDate.split("-");
    const year = Number(y);
    const month = Number(m);
    if (!Number.isFinite(year) || !Number.isFinite(month)) continue;
    const key = `${year}-${month}`;
    const group = groups.get(key) ?? { year, month, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return groups;
}

/* ── Cross-replica ingest lock (transitional) ── */

async function acquireIngestLock(): Promise<boolean> {
  if (inProgress) return false;
  try {
    const existing = await getSetting(INGEST_LOCK_KEY);
    if (existing) {
      const ts = Number(existing.split(":")[0]);
      if (Number.isFinite(ts) && Date.now() - ts < INGEST_LOCK_TTL_MS) return false;
    }
    // Write a unique token, then re-read to confirm we still own the lock. If a
    // racing replica wrote after us, its token wins and we back off. Best-effort
    // (not atomic) but resistant to the simple read→write race — superseded when
    // C2 moves ingestion to a single dedicated cron Job.
    const ownerToken = `${Date.now()}:${randomUUID()}`;
    await setSetting(INGEST_LOCK_KEY, ownerToken);
    if ((await getSetting(INGEST_LOCK_KEY)) !== ownerToken) return false;
    inProgress = true;
    return true;
  } catch (err) {
    console.warn("AI Credit ingest lock acquisition failed:", err);
    return false;
  }
}

async function releaseIngestLock(): Promise<void> {
  inProgress = false;
  try {
    await deleteSetting(INGEST_LOCK_KEY);
  } catch (err) {
    console.warn("AI Credit ingest lock release failed:", err);
  }
}

/**
 * Ingest AI Credit usage via the async report export and persist per-user rows
 * to `fact_ai_credit_usage`. Defaults to a first-of-month → yesterday (UTC)
 * month-to-date window. Guards against concurrent runs across replicas.
 */
export async function ingestAiCreditUsage(
  opts: IngestAiCreditOptions
): Promise<IngestAiCreditResult> {
  const result: IngestAiCreditResult = { rowsPersisted: 0, monthsPersisted: 0, windowsProcessed: 0 };

  const acquired = await acquireIngestLock();
  if (!acquired) {
    console.info("AI Credit ingestion skipped — another run holds the lock");
    return result;
  }

  try {
    const start = opts.startDate ?? firstOfMonthUtc();
    const end = opts.endDate ?? yesterdayUtc();
    const windows = splitWindows(start, end);
    if (windows.length === 0) {
      console.warn(`AI Credit ingestion skipped — invalid window ${start} → ${end}`);
      return result;
    }

    console.info(`AI Credit ingestion started (${start} → ${end}, ${windows.length} window(s))`);

    for (const window of windows) {
      const items = await fetchWindowItems(opts, window);
      result.windowsProcessed++;

      for (const { year, month, items: monthItems } of groupByMonth(items).values()) {
        await persistAiCreditSnapshot(opts.enterpriseSlug, year, month, monthItems);
        result.monthsPersisted++;
        result.rowsPersisted += monthItems.length;
      }
    }

    console.info(
      `AI Credit ingestion complete — rows: ${result.rowsPersisted}, ` +
      `months: ${result.monthsPersisted}, windows: ${result.windowsProcessed}`
    );
    return result;
  } finally {
    await releaseIngestLock();
  }
}

/* ── Diagnostic fallback (per-user live usage) ── */

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
  date?: string;
  organizationName?: string;
  user?: string;
  team?: string;
  costCenterName?: string;
  costCenter?: string;
}

/**
 * Diagnostic-only fallback: fetch a single user's AI Credit usage live from the
 * per-user `?user=` billing endpoint. Not used by the scheduled ingestion path —
 * kept for troubleshooting when the async report export is unavailable.
 */
export async function fetchAiCreditUsageForUser(opts: {
  token: string;
  enterpriseSlug: string;
  year: number;
  month: number;
  user: string;
}): Promise<NormalizedAiCreditItem[]> {
  const { token, enterpriseSlug, year, month, user } = opts;
  const url =
    `${GITHUB_API_BASE}/enterprises/${encodeURIComponent(enterpriseSlug)}` +
    `/settings/billing/ai_credit/usage?year=${year}&month=${month}&user=${encodeURIComponent(user)}`;

  const res = await fetch(url, { headers: githubHeaders(token) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Failed to fetch per-user ai_credit usage: ${res.status} ${res.statusText} ${body}`);
  }

  const data: { usageItems?: AiCreditUsageItem[] } = await res.json();
  return (data.usageItems ?? []).map((item) => ({
    usageDate: item.date ?? null,
    product: item.product ?? "Copilot",
    sku: item.sku ?? "",
    model: item.model ?? item.sku ?? "",
    costCenter: item.costCenterName ?? item.costCenter ?? null,
    orgName: item.organizationName ?? null,
    userLogin: item.user ? item.user.toLowerCase() : user.toLowerCase(),
    teamName: item.team ?? null,
    unitType: item.unitTypeString ?? item.unitType ?? "ai-credits",
    pricePerUnit: item.pricePerUnit ?? 0,
    grossQuantity: item.grossQuantity ?? 0,
    discountQuantity: item.discountQuantity ?? 0,
    netQuantity: item.netQuantity ?? 0,
    grossAmount: item.grossAmount ?? 0,
    discountAmount: item.discountAmount ?? 0,
    netAmount: item.netAmount ?? 0,
  }));
}
