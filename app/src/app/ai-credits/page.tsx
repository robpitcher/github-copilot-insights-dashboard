"use client";

import { useEffect, useMemo, useState } from "react";
import "@/lib/chart-registry";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { useChartOptions } from "@/lib/theme/chart-theme";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { PageHeader } from "@/components/layout/page-header";
import { ReportBanner } from "@/components/layout/report-banner";
import { DataTable } from "@/components/ui/data-table";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePdfExport } from "@/components/ui/pdf-export";
import { ConfigurationBanner } from "@/components/layout/configuration-banner";
import { DataSourceBanner } from "@/components/layout/report-filters";
import { InsightPanel } from "@/components/ai/insight-panel";
import { AlertTriangle, Settings, Lightbulb, ExternalLink, Coins } from "lucide-react";
import Link from "next/link";

interface CreditBucket {
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

interface AiCreditTotals {
  grossCredits: number;
  includedCredits: number;
  billableCredits: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
  discountCoveragePct: number;
  effectivePricePerCredit: number;
}

type ModelBreakdown = CreditBucket & { model: string };
type SkuBreakdown = CreditBucket & { sku: string };
type OrgBreakdown = CreditBucket & { org: string };
type TeamBreakdown = CreditBucket & { team: string };
type CostCenterBreakdown = CreditBucket & { costCenter: string };
type UserBreakdown = CreditBucket & { user: string; displayLabel: string };
type DailyTrendPoint = CreditBucket & { date: string };

interface MonthlyTrendPoint {
  year: number;
  month: number;
  label: string;
  grossCredits: number;
  billableCredits: number;
  grossAmount: number;
  netAmount: number;
}

interface ChangeVsPrevious {  creditsDelta: number;
  creditsDeltaPct: number | null;
  netAmountDelta: number;
  netAmountDeltaPct: number | null;
}

interface CreditPool {
  total: number;
  promotional: boolean;
  promotionalPeriod: string | null;
  perSeat: { business: number; enterprise: number };
  seats: { business: number; enterprise: number };
  consumedAmount: number;
  remainingAmount: number;
  utilizationPct: number;
}

interface UserCreditConsumption {
  userId: number;
  userLogin: string;
  displayLabel: string;
  creditsUsed: number;
  daysActive: number;
}

interface OrgCreditConsumption {
  orgId: number;
  orgName: string;
  creditsUsed: number;
}

interface TeamCreditConsumption {
  teamId: number;
  teamName: string;
  teamSlug: string;
  creditsUsed: number;
  members: number;
}

/** Per-user AI credit consumption signal (Copilot Usage Metrics, 2026-06-19). */
interface CreditConsumption {
  available: boolean;
  totalCreditsUsed: number;
  activeUsers: number;
  perUser: UserCreditConsumption[];
  perOrg: OrgCreditConsumption[];
  perTeam: TeamCreditConsumption[];
}

interface AiCreditData {
  period: { year: number; month: number };
  unitType: string;
  totals: AiCreditTotals;
  seats: { total: number; planCounts: Record<string, number> };
  creditPool: CreditPool;
  filters: {
    options: {
      models: Array<{ value: string; label: string }>;
      costCenters: string[];
      users: Array<{ userId: number; displayLabel: string }>;
      orgs: Array<{ id: number; name: string }>;
      teams: Array<{ id: number; name: string; slug: string; memberCount: number }>;
    };
    selected: { model: string; costCenter: string; userId: string; orgId: string; teamId: string };
  };
  perModelBreakdown: ModelBreakdown[];
  perSkuBreakdown: SkuBreakdown[];
  perUserBreakdown: UserBreakdown[];
  perOrgBreakdown: OrgBreakdown[];
  perTeamBreakdown: TeamBreakdown[];
  perCostCenterBreakdown: CostCenterBreakdown[];
  dailyTrend: DailyTrendPoint[];
  monthlyTrend: MonthlyTrendPoint[];
  changeVsPrevious: ChangeVsPrevious | null;
  creditConsumption: CreditConsumption;
}

interface DashboardOverlay {
  kpis?: { totalCodeAccept?: number };
}

interface PullRequestsOverlay {
  totals?: { totalMerged?: number; totalReviewed?: number };
}

function fmt$(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

function fmtDelta(v: number, unit = "") {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("en-US", { maximumFractionDigits: 1 })}${unit}`;
}

function monthStart(year: number, month: number) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function monthEnd(year: number, month: number) {
  const d = new Date(year, month, 0);
  return `${year}-${String(month).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MODEL_COLORS = [
  "#8b5cf6", "#a855f7", "#c084fc", "#d8b4fe", "#7c3aed",
  "#6d28d9", "#5b21b6", "#4c1d95", "#ec4899", "#f43f5e",
  "#3b82f6", "#6366f1", "#14b8a6", "#f59e0b", "#10b981",
];

export default function AiCreditsPage() {
  const { commonOptions: barOpts, doughnutOptions: doughnutOpts } = useChartOptions();
  const { t } = useTranslation();
  const now = new Date();
  // Applied snapshot drives the data fetch; the filter bar edits draft state and
  // commits it on Apply (mirrors the shared ReportFilters experience).
  const [applied, setApplied] = useState(() => ({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
    models: [] as string[],
    costCenters: [] as string[],
    userIds: [] as string[],
    orgIds: [] as string[],
    teamIds: [] as string[],
  }));
  const { year, month } = applied;
  const [draftYear, setDraftYear] = useState(applied.year);
  const [draftMonth, setDraftMonth] = useState(applied.month);
  const [modelFilter, setModelFilter] = useState<string[]>([]);
  const [costCenterFilter, setCostCenterFilter] = useState<string[]>([]);
  const [userId, setUserId] = useState<string[]>([]);
  const [orgId, setOrgId] = useState<string[]>([]);
  const [teamId, setTeamId] = useState<string[]>([]);
  const [trendGranularity, setTrendGranularity] = useState<"daily" | "weekly" | "monthly" | "3m" | "6m">("monthly");
  const [data, setData] = useState<AiCreditData | null>(null);
  const [dashboardOverlay, setDashboardOverlay] = useState<DashboardOverlay | null>(null);
  const [prOverlay, setPrOverlay] = useState<PullRequestsOverlay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { ref: reportRef, ExportButton: PdfButton } = usePdfExport("copilot-ai-credits");

  useEffect(() => {
    setLoading(true);
    setError(null);

    const { year: y, month: m, models, costCenters, userIds, orgIds, teamIds } = applied;
    const start = monthStart(y, m);
    const end = monthEnd(y, m);
    const params = new URLSearchParams({ year: String(y), month: String(m) });
    if (models.length) params.set("model", models.join(","));
    if (costCenters.length) params.set("costCenter", costCenters.join(","));
    if (userIds.length) params.set("userId", userIds.join(","));
    if (orgIds.length) params.set("orgId", orgIds.join(","));
    if (teamIds.length) params.set("teamId", teamIds.join(","));

    Promise.all([
      fetch(`/api/metrics/ai-credits?${params.toString()}`).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<AiCreditData>;
      }),
      fetch(`/api/metrics/dashboard?start=${start}&end=${end}`).then(async (res) => (res.ok ? res.json() as Promise<DashboardOverlay> : null)),
      fetch(`/api/metrics/pull-requests?start=${start}&end=${end}`).then(async (res) => (res.ok ? res.json() as Promise<PullRequestsOverlay> : null)),
    ])
      .then(([credits, dashboard, prs]) => {
        setData(credits);
        setDashboardOverlay(dashboard);
        setPrOverlay(prs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [applied]);

  useEffect(() => {
    if (!data) return;
    const o = data.filters.options;
    const valid = {
      models: new Set(o.models.map((m) => m.value)),
      costCenters: new Set(o.costCenters),
      users: new Set(o.users.map((u) => String(u.userId))),
      orgs: new Set(o.orgs.map((x) => String(x.id))),
      teams: new Set(o.teams.map((x) => String(x.id))),
    };
    const prune = (prev: string[], allowed: Set<string>) => {
      const next = prev.filter((v) => allowed.has(v));
      return next.length === prev.length ? prev : next;
    };
    setModelFilter((p) => prune(p, valid.models));
    setCostCenterFilter((p) => prune(p, valid.costCenters));
    setUserId((p) => prune(p, valid.users));
    setOrgId((p) => prune(p, valid.orgs));
    setTeamId((p) => prune(p, valid.teams));
  }, [data]);

  const compositionDonut = useMemo(() => {
    if (!data) return null;
    const { includedCredits, billableCredits } = data.totals;
    return {
      labels: [t("aiCredits.includedCredits"), t("aiCredits.billableCredits")],
      datasets: [{
        data: [includedCredits, billableCredits],
        backgroundColor: ["#22c55e", "#6366f1"],
        borderWidth: 0,
      }],
    };
  }, [data, t]);

  const creditPoolDonut = useMemo(() => {
    if (!data) return null;
    const { consumedAmount, remainingAmount } = data.creditPool;
    if (consumedAmount <= 0 && remainingAmount <= 0) return null;
    return {
      labels: [t("aiCredits.poolConsumed"), t("aiCredits.poolRemaining")],
      datasets: [{
        data: [consumedAmount, remainingAmount],
        backgroundColor: ["#6366f1", "#22c55e"],
        borderWidth: 0,
      }],
    };
  }, [data, t]);

  const modelBar = useMemo(() => {
    if (!data || data.perModelBreakdown.length === 0) return null;
    const top = data.perModelBreakdown.slice(0, 15);
    return {
      labels: top.map((m) => m.model),
      datasets: [{
        label: t("aiCredits.creditsLabel"),
        data: top.map((m) => m.grossQuantity),
        backgroundColor: top.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const costCenterBar = useMemo(() => {
    if (!data || data.perCostCenterBreakdown.length === 0) return null;
    const top = data.perCostCenterBreakdown.slice(0, 12);
    return {
      labels: top.map((c) => c.costCenter),
      datasets: [{
        label: t("aiCredits.creditsLabel"),
        data: top.map((c) => c.grossQuantity),
        backgroundColor: "#10b981",
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const orgBar = useMemo(() => {
    if (!data || data.creditConsumption.perOrg.length === 0) return null;
    const top = data.creditConsumption.perOrg.slice(0, 12);
    return {
      labels: top.map((o) => o.orgName),
      datasets: [{
        label: t("aiCredits.creditsUsedLabel"),
        data: top.map((o) => o.creditsUsed),
        backgroundColor: "#6366f1",
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const teamBar = useMemo(() => {
    if (!data || data.creditConsumption.perTeam.length === 0) return null;
    const top = data.creditConsumption.perTeam.slice(0, 12);
    return {
      labels: top.map((o) => o.teamName),
      datasets: [{
        label: t("aiCredits.creditsUsedLabel"),
        data: top.map((o) => o.creditsUsed),
        backgroundColor: "#f59e0b",
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const consumptionUserBar = useMemo(() => {
    if (!data || data.creditConsumption.perUser.length === 0) return null;
    const top = data.creditConsumption.perUser.slice(0, 15);
    return {
      labels: top.map((u) => u.displayLabel),
      datasets: [{
        label: t("aiCredits.creditsUsedLabel"),
        data: top.map((u) => u.creditsUsed),
        backgroundColor: top.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const dailyCostTrend = useMemo(() => {
    if (!data || data.dailyTrend.length === 0) return null;
    return {
      labels: data.dailyTrend.map((d) => d.date.slice(8, 10)),
      datasets: [
        {
          type: "bar" as const,
          label: t("aiCredits.creditsLabel"),
          data: data.dailyTrend.map((d) => d.grossQuantity),
          yAxisID: "y",
          backgroundColor: "#6366f1",
          borderRadius: 4,
        },
        {
          type: "line" as const,
          label: t("aiCredits.netSpend"),
          data: data.dailyTrend.map((d) => Number(d.netAmount.toFixed(2))),
          yAxisID: "y1",
          borderColor: "#10b981",
          backgroundColor: "#10b981",
          tension: 0.25,
          pointRadius: 2,
        },
      ],
    };
  }, [data, t]);

  const netSpendTrend = useMemo(() => {
    if (!data) return null;
    const borderColor = "#6366f1";
    const backgroundColor = "rgba(99,102,241,0.2)";
    const mkLine = (labels: string[], values: number[]) => ({
      labels,
      datasets: [{
        label: t("aiCredits.netSpend"),
        data: values,
        borderColor,
        backgroundColor,
        fill: true,
        tension: 0.3,
      }],
    });

    if (trendGranularity === "daily") {
      if (data.dailyTrend.length === 0) return null;
      return mkLine(
        data.dailyTrend.map((d) => d.date.slice(5)),
        data.dailyTrend.map((d) => Number(d.netAmount.toFixed(2))),
      );
    }

    if (trendGranularity === "weekly") {
      if (data.dailyTrend.length === 0) return null;
      const weeks = new Map<number, number>();
      for (const d of data.dailyTrend) {
        const dayOfMonth = Number(d.date.slice(8, 10));
        const week = Math.floor((dayOfMonth - 1) / 7) + 1;
        weeks.set(week, (weeks.get(week) ?? 0) + d.netAmount);
      }
      const entries = Array.from(weeks.entries()).sort((a, b) => a[0] - b[0]);
      return mkLine(
        entries.map(([w]) => t("aiCredits.weekLabel", String(w))),
        entries.map(([, v]) => Number(v.toFixed(2))),
      );
    }

    const months = trendGranularity === "3m" ? data.monthlyTrend.slice(-3) : data.monthlyTrend;
    if (months.length === 0) return null;
    return mkLine(months.map((m) => m.label), months.map((m) => m.netAmount));
  }, [data, t, trendGranularity]);

  const topDriversBar = useMemo(() => {
    if (!data || data.perModelBreakdown.length === 0) return null;
    const top = data.perModelBreakdown.slice(0, 5);
    return {
      labels: top.map((d) => d.model),
      datasets: [{
        label: t("aiCredits.netSpend"),
        data: top.map((d) => d.netAmount),
        backgroundColor: ["#8b5cf6", "#a855f7", "#6366f1", "#3b82f6", "#14b8a6"],
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const changeComparisonBar = useMemo(() => {
    if (!data || !data.changeVsPrevious) return null;
    const prevCredits = data.totals.grossCredits - data.changeVsPrevious.creditsDelta;
    const prevSpend = data.totals.netAmount - data.changeVsPrevious.netAmountDelta;
    return {
      labels: [t("aiCredits.creditsLabel"), t("aiCredits.netSpend")],
      datasets: [
        {
          label: t("aiCredits.previousMonth"),
          data: [prevCredits, Number(prevSpend.toFixed(2))],
          backgroundColor: "#cbd5e1",
          borderRadius: 6,
        },
        {
          label: t("aiCredits.currentMonth"),
          data: [data.totals.grossCredits, Number(data.totals.netAmount.toFixed(2))],
          backgroundColor: "#6366f1",
          borderRadius: 6,
        },
      ],
    };
  }, [data, t]);

  const efficiencyBar = useMemo(() => {
    if (!data) return null;
    const ca = dashboardOverlay?.kpis?.totalCodeAccept ?? 0;
    const mp = prOverlay?.totals?.totalMerged ?? 0;
    const rp = prOverlay?.totals?.totalReviewed ?? 0;
    const costAccept = ca > 0 ? Number((data.totals.netAmount / ca).toFixed(4)) : 0;
    const costMerge = mp > 0 ? Number((data.totals.netAmount / mp).toFixed(2)) : 0;
    const costReview = rp > 0 ? Number((data.totals.netAmount / rp).toFixed(2)) : 0;
    return {
      labels: [t("aiCredits.perAcceptedGeneration"), t("aiCredits.perMergedPr"), t("aiCredits.perReviewedPr")],
      datasets: [{
        label: t("aiCredits.costLabel"),
        data: [costAccept, costMerge, costReview],
        backgroundColor: ["#22c55e", "#3b82f6", "#f59e0b"],
        borderRadius: 6,
      }],
    };
  }, [data, dashboardOverlay, prOverlay, t]);

  const goMonth = (delta: number) => {
    let m = draftMonth + delta;
    let y = draftYear;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setDraftYear(y);
    setDraftMonth(m);
  };

  const sameSelection = (a: string[], b: string[]) =>
    a.length === b.length && a.every((v) => b.includes(v));
  const hasActiveFilters =
    modelFilter.length > 0 ||
    costCenterFilter.length > 0 ||
    userId.length > 0 ||
    orgId.length > 0 ||
    teamId.length > 0;
  const filtersDirty =
    draftYear !== applied.year ||
    draftMonth !== applied.month ||
    !sameSelection(modelFilter, applied.models) ||
    !sameSelection(costCenterFilter, applied.costCenters) ||
    !sameSelection(userId, applied.userIds) ||
    !sameSelection(orgId, applied.orgIds) ||
    !sameSelection(teamId, applied.teamIds);
  const applyFilters = () => {
    setApplied({
      year: draftYear,
      month: draftMonth,
      models: modelFilter,
      costCenters: costCenterFilter,
      userIds: userId,
      orgIds: orgId,
      teamIds: teamId,
    });
  };
  const resetFilters = () => {
    setModelFilter([]);
    setCostCenterFilter([]);
    setUserId([]);
    setOrgId([]);
    setTeamId([]);
    setApplied((prev) => ({ ...prev, models: [], costCenters: [], userIds: [], orgIds: [], teamIds: [] }));
  };
  const fmtPeriodDay = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const periodRangeLabel = `${fmtPeriodDay(monthStart(draftYear, draftMonth))} – ${fmtPeriodDay(monthEnd(draftYear, draftMonth))}`;

  if (loading) {
    return <LoadingSpinner message={t("aiCredits.loading")} />;
  }

  if (error) {
    return (
      <div className="space-y-6">
        <ConfigurationBanner />
        <div className="flex flex-col items-center justify-center rounded-lg border border-amber-200 bg-amber-50 px-6 py-16 text-center dark:border-amber-800 dark:bg-amber-950/40">
          <div className="mb-4 rounded-full bg-amber-100 p-4 dark:bg-amber-900/50">
            <AlertTriangle className="h-8 w-8 text-amber-500 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("common.apiError")}
          </h3>
          <p className="mx-auto mt-2 max-w-lg text-sm text-gray-600 dark:text-gray-400">
            {error}
          </p>
          <Link
            href="/settings"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700"
          >
            <Settings className="h-4 w-4" />
            {t("configBanner.goToSettings")}
          </Link>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { totals } = data;

  const lastTrendDay = data.dailyTrend[data.dailyTrend.length - 1]?.date;
  const elapsedDays = lastTrendDay ? Number(lastTrendDay.slice(8, 10)) : 0;
  const avgDailyCredits = elapsedDays > 0 ? totals.grossCredits / elapsedDays : 0;

  const currentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const projectedEomSpend = currentMonth && elapsedDays > 0
    ? (totals.netAmount / elapsedDays) * daysInMonth(year, month)
    : totals.netAmount;
  const projectedEomCredits = currentMonth && elapsedDays > 0
    ? (totals.grossCredits / elapsedDays) * daysInMonth(year, month)
    : totals.grossCredits;

  const codeAccepts = dashboardOverlay?.kpis?.totalCodeAccept ?? 0;
  const mergedPrs = prOverlay?.totals?.totalMerged ?? 0;
  const reviewedPrs = prOverlay?.totals?.totalReviewed ?? 0;

  // Additional business-value metrics for AI usage governance. Active users and
  // per-user credit consumption come from the usage-metrics signal
  // (ai_credits_used); billing dollars stay enterprise-wide because the billing
  // feed has no per-user breakdown.
  const consumption = data.creditConsumption;
  const creditsConsumed = consumption.totalCreditsUsed;
  const activeUsers = consumption.activeUsers || data.perUserBreakdown.length;
  const modelsInUse = data.perModelBreakdown.length;
  const costPerActiveUser = activeUsers > 0 ? totals.netAmount / activeUsers : 0;
  const creditsPerActiveUser = activeUsers > 0
    ? (creditsConsumed > 0 ? creditsConsumed : totals.grossCredits) / activeUsers
    : 0;
  const topConsumer = consumption.perUser[0] ?? null;
  const topModelSharePct = totals.netAmount > 0 && data.perModelBreakdown.length > 0
    ? Math.round((data.perModelBreakdown[0].netAmount / totals.netAmount) * 100)
    : 0;
  // "Additional usage" mirrors the official report: spend beyond included credits.
  const additionalUsage = totals.netAmount;

  return (
    <div ref={reportRef} className="space-y-6">
      <ConfigurationBanner />
      <PageHeader
        title={t("aiCredits.title")}
        subtitle={t("aiCredits.subtitle")}
        actions={<PdfButton />}
      />
      <DataSourceBanner sourceLabel="GitHub AI Credit Billing API (/settings/billing/ai_credit/usage) + per-user ai_credits_used (Copilot Usage Metrics) + PR overlays" live />
      <ReportBanner title={t("aiCredits.aboutTitle")} body={t("aiCredits.aboutBody")} />

      <InsightPanel
        kind="cost_license"
        title={t("aiAnalyst.cost")}
        icon={Coins}
        start={monthStart(year, month)}
        end={monthEnd(year, month)}
      />

      <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">
        {t("aiCredits.ubbNotice")}
      </div>

      {/* Token optimization resources */}
      <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-800 dark:bg-indigo-900/30">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
          <h3 className="font-semibold text-indigo-900 dark:text-indigo-200">{t("aiCredits.optimizeTitle")}</h3>
        </div>
        <p className="mt-1 text-sm text-indigo-700 dark:text-indigo-300">{t("aiCredits.optimizeDesc")}</p>
        <ul className="mt-3 grid grid-cols-1 gap-2 text-sm text-indigo-700 dark:text-indigo-300 md:grid-cols-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <li key={n} className="flex items-start gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400 dark:bg-indigo-500" />
              <span>
                {t(`aiCredits.optimizeTip${n}`)}
                {" — "}
                <a
                  href={t(`aiCredits.optimizeTip${n}Link`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium underline hover:text-indigo-900 dark:hover:text-indigo-100"
                >
                  {t(`aiCredits.optimizeTip${n}LinkText`)} <ExternalLink className="h-3 w-3" />
                </a>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Card title={t("aiCredits.filtersTitle")} subtitle={t("aiCredits.filtersDesc")}>
        <div className="mb-3 flex flex-wrap items-center gap-2 border-b border-gray-100 pb-3 dark:border-gray-700">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("aiCredits.period")}
          </span>
          <button
            onClick={() => goMonth(-1)}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            ← {t("aiCredits.prev")}
          </button>
          <span className="min-w-28 text-center text-sm font-medium text-gray-900 dark:text-gray-100">
            {MONTH_NAMES[draftMonth - 1]} {draftYear}
          </span>
          <button
            onClick={() => goMonth(1)}
            disabled={draftYear === now.getFullYear() && draftMonth === now.getMonth() + 1}
            className="rounded-md border border-gray-300 px-2.5 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t("aiCredits.next")} →
          </button>
          <span className="ml-1 text-xs text-gray-400 dark:text-gray-500">{periodRangeLabel}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <MultiSelectFilter
            label={t("aiCredits.model")}
            allLabel={t("common.all")}
            selected={modelFilter}
            onChange={setModelFilter}
            options={data.filters.options.models.map((m) => ({ value: m.value, label: m.label }))}
          />
          <MultiSelectFilter
            label={t("aiCredits.costCenter")}
            allLabel={t("common.all")}
            selected={costCenterFilter}
            onChange={setCostCenterFilter}
            options={data.filters.options.costCenters.map((v) => ({ value: v, label: v }))}
            emptyHint={t("aiCredits.noFilterData")}
          />
          <MultiSelectFilter
            label={t("aiCredits.organization")}
            allLabel={t("common.all")}
            selected={orgId}
            onChange={setOrgId}
            options={data.filters.options.orgs.map((o) => ({ value: String(o.id), label: o.name }))}
            emptyHint={t("aiCredits.noFilterData")}
          />
          <MultiSelectFilter
            label={t("aiCredits.user")}
            allLabel={t("common.all")}
            selected={userId}
            onChange={setUserId}
            options={data.filters.options.users.map((u) => ({ value: String(u.userId), label: u.displayLabel }))}
            emptyHint={t("aiCredits.noFilterData")}
          />
          <MultiSelectFilter
            label={t("aiCredits.team")}
            allLabel={t("common.all")}
            selected={teamId}
            onChange={setTeamId}
            options={data.filters.options.teams.map((tm) => ({ value: String(tm.id), label: tm.name }))}
            emptyHint={t("aiCredits.noFilterData")}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-gray-100 pt-3 dark:border-gray-700">
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              {t("aiCredits.reset")}
            </button>
          )}
          <button
            type="button"
            onClick={applyFilters}
            disabled={!filtersDirty}
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.apply")}
          </button>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label={t("aiCredits.grossCredits")} value={fmtNum(totals.grossCredits)} />
        <Kpi label={t("aiCredits.includedCredits")} value={fmtNum(totals.includedCredits)} color="text-green-600" />
        <Kpi label={t("aiCredits.billableCredits")} value={fmtNum(totals.billableCredits)} color={totals.billableCredits > 0 ? "text-indigo-600" : "text-gray-900"} />
        <Kpi label={t("aiCredits.netAmount")} value={fmt$(totals.netAmount)} color={totals.netAmount > 0 ? "text-indigo-600" : "text-gray-900"} />
        <Kpi label={t("aiCredits.discountCoverage")} value={`${totals.discountCoveragePct}%`} color={totals.discountCoveragePct >= 80 ? "text-green-600" : totals.discountCoveragePct >= 50 ? "text-amber-600" : "text-indigo-600"} />
      </div>

      <Card title={t("aiCredits.usageInsights")} subtitle={t("aiCredits.usageInsightsDesc")}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label={t("aiCredits.activeUsers")} value={fmtNum(activeUsers)} />
          <Kpi label={t("aiCredits.costPerActiveUser")} value={fmt$(costPerActiveUser)} color="text-indigo-600" />
          <Kpi label={t("aiCredits.creditsPerActiveUser")} value={fmtNum(Math.round(creditsPerActiveUser))} />
          <Kpi label={t("aiCredits.modelsInUse")} value={fmtNum(modelsInUse)} />
          <Kpi label={t("aiCredits.topModelShare")} value={`${topModelSharePct}%`} color={topModelSharePct >= 60 ? "text-amber-600" : "text-gray-900"} />
          <Kpi label={t("aiCredits.additionalUsage")} value={fmt$(additionalUsage)} color={additionalUsage > 0 ? "text-indigo-600" : "text-green-600"} />
        </div>
      </Card>

      <Card title={t("aiCredits.consumptionTitle")} subtitle={t("aiCredits.consumptionDesc")}>
        {consumption.available ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Kpi label={t("aiCredits.creditsConsumed")} value={fmtNum(creditsConsumed)} color="text-indigo-600" />
              <Kpi label={t("aiCredits.creditUsers")} value={fmtNum(activeUsers)} />
              <Kpi label={t("aiCredits.avgCreditsPerUser")} value={fmtNum(Math.round(creditsPerActiveUser))} />
              <Kpi label={t("aiCredits.topConsumer")} value={topConsumer ? fmtNum(topConsumer.creditsUsed) : "\u2014"} color="text-amber-600" />
            </div>
            <p className="mb-3 rounded-md bg-indigo-50 px-3 py-2 text-xs text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300">
              {t("aiCredits.consumptionNote")}
            </p>
            {consumptionUserBar && (
              <div className="h-[280px]"><Bar data={consumptionUserBar} options={{ ...barOpts, maintainAspectRatio: false, plugins: { ...barOpts.plugins, legend: { display: false } } }} /></div>
            )}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.consumptionUnavailable")}</p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("aiCredits.execSummary")} subtitle={t("aiCredits.execSummaryDesc")}>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.totalSpend")}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt$(totals.netAmount)}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.pricePerCredit")}</p>
              <p className="text-lg font-bold text-indigo-600 dark:text-indigo-400">{fmt$(totals.effectivePricePerCredit)}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.eomForecast")}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt$(projectedEomSpend)}</p>
            </div>
          </div>
          {topDriversBar ? (
            <div className="h-[180px]">
              <Bar data={topDriversBar} options={{ ...barOpts, indexAxis: "y" as const, maintainAspectRatio: false, plugins: { ...barOpts.plugins, legend: { display: false } } }} />
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-gray-400">{t("aiCredits.noModelDriver")}</p>
          )}
          <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.topSpendDrivers")}</p>
        </Card>

        <Card title={t("aiCredits.whatChanged")} subtitle={t("aiCredits.whatChangedDesc")}>
          {changeComparisonBar && data.changeVsPrevious ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.creditsChange")}</p>
                  <p className={`text-lg font-bold ${data.changeVsPrevious.creditsDelta >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-green-600 dark:text-green-400"}`}>
                    {fmtDelta(data.changeVsPrevious.creditsDelta)}
                    {data.changeVsPrevious.creditsDeltaPct !== null ? ` (${fmtDelta(data.changeVsPrevious.creditsDeltaPct, "%")})` : ""}
                  </p>
                </div>
                <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.spendChange")}</p>
                  <p className={`text-lg font-bold ${data.changeVsPrevious.netAmountDelta >= 0 ? "text-indigo-600 dark:text-indigo-400" : "text-green-600 dark:text-green-400"}`}>
                    {fmtDelta(Number(data.changeVsPrevious.netAmountDelta.toFixed(2)), "")}
                    {data.changeVsPrevious.netAmountDeltaPct !== null ? ` (${fmtDelta(data.changeVsPrevious.netAmountDeltaPct, "%")})` : ""}
                  </p>
                </div>
              </div>
              <div className="h-[180px]">
                <Bar data={changeComparisonBar} options={{ ...barOpts, maintainAspectRatio: false }} />
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.noPrevComparison")}</p>
          )}
        </Card>
      </div>

      <Card title={t("aiCredits.creditPool")} subtitle={t("aiCredits.creditPoolDesc")}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
              <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.poolTotal")}</p>
                <p className="text-lg font-bold text-green-600 dark:text-green-400">{fmt$(data.creditPool.total)}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.poolConsumed")}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt$(data.creditPool.consumedAmount)}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.poolRemaining")}</p>
                <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt$(data.creditPool.remainingAmount)}</p>
              </div>
              <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.poolUtilization")}</p>
                <p className={`text-lg font-bold ${data.creditPool.utilizationPct >= 90 ? "text-amber-600 dark:text-amber-400" : "text-indigo-600 dark:text-indigo-400"}`}>{data.creditPool.utilizationPct}%</p>
              </div>
            </div>
            <div className="mt-3 space-y-1 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
              <p>
                {t(
                  "aiCredits.poolPerSeat",
                  fmt$(data.creditPool.perSeat.business),
                  String(data.creditPool.seats.business),
                  fmt$(data.creditPool.perSeat.enterprise),
                  String(data.creditPool.seats.enterprise)
                )}
              </p>
              {data.creditPool.promotional && data.creditPool.promotionalPeriod && (
                <p className="font-medium text-green-600 dark:text-green-400">
                  {t("aiCredits.poolPromotional", data.creditPool.promotionalPeriod)}
                </p>
              )}
              <p>{t("aiCredits.additionalUsage")}: <span className="font-medium text-gray-900 dark:text-gray-100">{fmt$(additionalUsage)}</span></p>
            </div>
          </div>
          <div className="flex items-center justify-center">
            {creditPoolDonut ? (
              <div className="flex items-center gap-4">
                <div className="relative h-[180px] w-[180px] shrink-0">
                  <Doughnut data={creditPoolDonut} options={{ ...doughnutOpts, cutout: "70%", maintainAspectRatio: false, plugins: { ...doughnutOpts.plugins, legend: { display: false } } }} />
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className={`text-2xl font-bold ${data.creditPool.utilizationPct >= 90 ? "text-amber-600 dark:text-amber-400" : "text-indigo-600 dark:text-indigo-400"}`}>{data.creditPool.utilizationPct}%</span>
                    <span className="text-[10px] uppercase tracking-wider text-gray-400">{t("aiCredits.poolUtilization")}</span>
                  </div>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full bg-indigo-500" />
                    <span className="text-gray-600 dark:text-gray-300">{t("aiCredits.poolConsumed")}: <span className="font-medium text-gray-900 dark:text-gray-100">{fmt$(data.creditPool.consumedAmount)}</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                    <span className="text-gray-600 dark:text-gray-300">{t("aiCredits.poolRemaining")}: <span className="font-medium text-gray-900 dark:text-gray-100">{fmt$(data.creditPool.remainingAmount)}</span></span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.noModelDriver")}</p>
            )}
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("aiCredits.creditComposition")} subtitle={t("aiCredits.creditCompositionDesc")}>
          <div className="flex items-center gap-4">
            {compositionDonut && (
              <div className="h-[200px] w-[200px] shrink-0">
                <Doughnut data={compositionDonut} options={{ ...doughnutOpts, cutout: "65%", maintainAspectRatio: false, plugins: { ...doughnutOpts.plugins, legend: { display: false } } }} />
              </div>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-green-500" />
                <span className="text-gray-600 dark:text-gray-300">{t("aiCredits.includedCredits")}: <span className="font-medium text-gray-900 dark:text-gray-100">{fmtNum(totals.includedCredits)}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-indigo-500" />
                <span className="text-gray-600 dark:text-gray-300">{t("aiCredits.billableCredits")}: <span className="font-medium text-gray-900 dark:text-gray-100">{fmtNum(totals.billableCredits)}</span></span>
              </div>
              <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.avgDailyCredits")}: <span className="font-medium">{fmtNum(Math.round(avgDailyCredits))}</span></p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.projectedEomCredits")}: <span className="font-medium">{fmtNum(Math.round(projectedEomCredits))}</span></p>
                <p className="text-xs text-gray-500 dark:text-gray-400">{t("aiCredits.grossAmount")}: <span className="font-medium">{fmt$(totals.grossAmount)}</span></p>
              </div>
            </div>
          </div>
        </Card>

        <Card title={t("aiCredits.efficiencyMetrics")} subtitle={t("aiCredits.efficiencyMetricsDesc")}>
          {efficiencyBar ? (
            <>
              <div className="h-[180px]">
                <Bar data={efficiencyBar} options={{ ...barOpts, indexAxis: "y" as const, maintainAspectRatio: false, plugins: { ...barOpts.plugins, legend: { display: false } } }} />
              </div>
              <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                {t("aiCredits.efficiencyBasis", `${fmtNum(codeAccepts)}`, `${fmtNum(mergedPrs)}`, `${fmtNum(reviewedPrs)}`)}
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.noOverlay")}</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("aiCredits.dailyTrend")} subtitle={t("aiCredits.dailyTrendDesc")}>
          {dailyCostTrend ? (
            <div className="h-[280px]"><Bar data={dailyCostTrend as never} options={{
              ...barOpts,
              maintainAspectRatio: false,
              scales: {
                y: { beginAtZero: true, position: "left" as const, title: { display: true, text: t("aiCredits.creditsLabel") } },
                y1: { beginAtZero: true, position: "right" as const, grid: { drawOnChartArea: false }, title: { display: true, text: t("aiCredits.netSpend") } },
              },
            }} /></div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.noDailyTrend")}</p>
          )}
        </Card>
        <Card title={t("aiCredits.monthlyTrend")} subtitle={t("aiCredits.monthlyTrendDesc")}>
          <div className="mb-3 flex items-center justify-end">
            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
              <span className="font-medium">{t("aiCredits.granularity")}</span>
              <select
                value={trendGranularity}
                onChange={(e) => setTrendGranularity(e.target.value as typeof trendGranularity)}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 shadow-xs focus:border-blue-500 focus:outline-hidden dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
              >
                <option value="daily">{t("aiCredits.granularityDaily")}</option>
                <option value="weekly">{t("aiCredits.granularityWeekly")}</option>
                <option value="monthly">{t("aiCredits.granularityMonthly")}</option>
                <option value="3m">{t("aiCredits.granularity3m")}</option>
                <option value="6m">{t("aiCredits.granularity6m")}</option>
              </select>
            </label>
          </div>
          {netSpendTrend ? (
            <div className="h-[280px]"><Line data={netSpendTrend} options={{ ...barOpts, maintainAspectRatio: false }} /></div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.noMonthlyTrend")}</p>
          )}
        </Card>
      </div>

      <Card title={t("aiCredits.recommendations")} subtitle={t("aiCredits.recommendationsDesc")}>
        <ul className="list-inside list-disc space-y-2 text-sm text-gray-700 dark:text-gray-300">
          {totals.billableCredits > 0 && <li>{t("aiCredits.recBillable")}</li>}
          {totals.discountCoveragePct < 50 && totals.grossCredits > 0 && <li>{t("aiCredits.recLowCoverage")}</li>}
          {data.perCostCenterBreakdown.length > 0 && data.perCostCenterBreakdown[0].netAmount > totals.netAmount * 0.35 && (
            <li>{t("aiCredits.recCostCenter")}</li>
          )}
          {data.perModelBreakdown.length > 0 && data.perModelBreakdown[0].netAmount > totals.netAmount * 0.5 && (
            <li>{t("aiCredits.recModelConcentration")}</li>
          )}
          {totals.billableCredits === 0 && totals.grossCredits > 0 && (
            <li>{t("aiCredits.recWithinEntitlement")}</li>
          )}
        </ul>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("aiCredits.byModel")} subtitle={t("aiCredits.byModelDesc")}>
          {modelBar ? (
            <div className="h-[280px]"><Bar data={modelBar} options={barOpts} /></div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">{t("aiCredits.noModelData")}</p>
          )}
        </Card>
        {costCenterBar ? (
          <Card title={t("aiCredits.byCostCenter")} subtitle={t("aiCredits.byCostCenterDesc")}>
            <div className="h-[280px]"><Bar data={costCenterBar} options={barOpts} /></div>
          </Card>
        ) : orgBar ? (
          <Card title={t("aiCredits.byOrganization")} subtitle={t("aiCredits.byOrganizationDesc")}>
            <div className="h-[280px]"><Bar data={orgBar} options={barOpts} /></div>
          </Card>
        ) : null}
      </div>

      {costCenterBar && orgBar && (
        <Card title={t("aiCredits.byOrganization")} subtitle={t("aiCredits.byOrganizationDesc")}>
          <div className="h-[280px]"><Bar data={orgBar} options={barOpts} /></div>
        </Card>
      )}

      {teamBar && (
        <Card title={t("aiCredits.byTeam")} subtitle={t("aiCredits.byTeamDesc")}>
          <div className="h-[280px]"><Bar data={teamBar} options={barOpts} /></div>
        </Card>
      )}

      {data.perCostCenterBreakdown.length > 0 && (
        <Card title={t("aiCredits.costCenterBreakdown")} subtitle={t("aiCredits.costCenterBreakdownDesc")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4">{t("aiCredits.costCenter")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.creditsLabel")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.billableCredits")}</th>
                  <th className="pb-2 text-right">{t("aiCredits.netAmount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.perCostCenterBreakdown.map((c) => (
                  <tr key={c.costCenter} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">{c.costCenter}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(c.grossQuantity)}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(c.netQuantity)}</td>
                    <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmt$(c.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {data.perModelBreakdown.length > 0 && (
        <Card title={t("aiCredits.modelBreakdown")} subtitle={t("aiCredits.modelBreakdownDesc")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4">{t("aiCredits.model")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.grossCredits")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.includedCredits")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.billableCredits")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.grossAmount")}</th>
                  <th className="pb-2 text-right">{t("aiCredits.netAmount")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.perModelBreakdown.map((m) => (
                  <tr key={m.model} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">{m.model}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(m.grossQuantity)}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(m.discountQuantity)}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(m.netQuantity)}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmt$(m.grossAmount)}</td>
                    <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmt$(m.netAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {consumption.perUser.length > 0 && (
        <Card title={t("aiCredits.userBreakdown", `${consumption.perUser.length}`)} subtitle={t("aiCredits.userBreakdownDesc")}>
          <DataTable
            columns={[
              { key: "displayLabel", header: t("aiCredits.user"), render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{String(value)}</span> },
              { key: "creditsUsed", header: t("aiCredits.creditsUsedLabel"), align: "right", render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{fmtNum(Number(value))}</span> },
              { key: "daysActive", header: t("aiCredits.daysActive"), align: "right", render: (value: unknown) => fmtNum(Number(value)) },
            ]}
            data={(consumption.perUser) as unknown as Record<string, unknown>[]}
            emptyMessage={t("aiCredits.noUserData")}
            searchPlaceholder={t("common.searchUsersEllipsis")}
            pageSize={25}
            defaultSortKey="creditsUsed"
            defaultSortDir="desc"
          />
        </Card>
      )}

      {consumption.perTeam.length > 0 && (
        <Card title={t("aiCredits.teamBreakdown")} subtitle={t("aiCredits.teamBreakdownDesc")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4">{t("aiCredits.team")}</th>
                  <th className="pb-2 pr-4 text-right">{t("aiCredits.creditsUsedLabel")}</th>
                  <th className="pb-2 text-right">{t("aiCredits.contributingMembers")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {consumption.perTeam.map((tm) => (
                  <tr key={tm.teamId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">{tm.teamName}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(tm.creditsUsed)}</td>
                    <td className="py-2 text-right text-gray-700 dark:text-gray-300">{fmtNum(tm.members)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-xs dark:border-gray-700 dark:bg-gray-800">
      <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? "text-gray-900 dark:text-gray-100"}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
    </div>
  );
}
