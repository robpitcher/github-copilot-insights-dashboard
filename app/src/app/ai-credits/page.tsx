"use client";

import { useEffect, useMemo, useState } from "react";
import "@/lib/chart-registry";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { useChartOptions } from "@/lib/theme/chart-theme";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { PageHeader } from "@/components/layout/page-header";
import { DataTable } from "@/components/ui/data-table";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePdfExport } from "@/components/ui/pdf-export";
import { ConfigurationBanner } from "@/components/layout/configuration-banner";
import { DataSourceBanner } from "@/components/layout/report-filters";
import { AlertTriangle, Settings } from "lucide-react";
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
  creditsPerSeat: number;
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

interface ChangeVsPrevious {
  creditsDelta: number;
  creditsDeltaPct: number | null;
  netAmountDelta: number;
  netAmountDeltaPct: number | null;
}

interface AiCreditData {
  period: { year: number; month: number };
  unitType: string;
  totals: AiCreditTotals;
  seats: { total: number; planCounts: Record<string, number> };
  filters: {
    options: {
      models: string[];
      orgs: string[];
      users: Array<{ login: string; displayLabel: string }>;
      teams: string[];
      costCenters: string[];
    };
    selected: { model: string; org: string; user: string; team: string; costCenter: string };
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
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [modelFilter, setModelFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [costCenterFilter, setCostCenterFilter] = useState("");
  const [data, setData] = useState<AiCreditData | null>(null);
  const [dashboardOverlay, setDashboardOverlay] = useState<DashboardOverlay | null>(null);
  const [prOverlay, setPrOverlay] = useState<PullRequestsOverlay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { ref: reportRef, ExportButton: PdfButton } = usePdfExport("copilot-ai-credits");

  useEffect(() => {
    setLoading(true);
    setError(null);

    const start = monthStart(year, month);
    const end = monthEnd(year, month);
    const params = new URLSearchParams({ year: String(year), month: String(month) });
    if (modelFilter) params.set("model", modelFilter);
    if (orgFilter) params.set("org", orgFilter);
    if (userFilter) params.set("user", userFilter);
    if (teamFilter) params.set("team", teamFilter);
    if (costCenterFilter) params.set("costCenter", costCenterFilter);

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
  }, [year, month, modelFilter, orgFilter, userFilter, teamFilter, costCenterFilter]);

  useEffect(() => {
    if (!data) return;
    const { options } = data.filters;
    if (modelFilter && !options.models.includes(modelFilter)) setModelFilter("");
    if (orgFilter && !options.orgs.includes(orgFilter)) setOrgFilter("");
    if (userFilter && !options.users.some((u) => u.login === userFilter)) setUserFilter("");
    if (teamFilter && !options.teams.includes(teamFilter)) setTeamFilter("");
    if (costCenterFilter && !options.costCenters.includes(costCenterFilter)) setCostCenterFilter("");
  }, [data, modelFilter, orgFilter, userFilter, teamFilter, costCenterFilter]);

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
    if (!data || data.perOrgBreakdown.length === 0) return null;
    const top = data.perOrgBreakdown.slice(0, 12);
    return {
      labels: top.map((o) => o.org),
      datasets: [{
        label: t("aiCredits.creditsLabel"),
        data: top.map((o) => o.grossQuantity),
        backgroundColor: "#6366f1",
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const teamBar = useMemo(() => {
    if (!data || data.perTeamBreakdown.length === 0) return null;
    const top = data.perTeamBreakdown.slice(0, 12);
    return {
      labels: top.map((o) => o.team),
      datasets: [{
        label: t("aiCredits.creditsLabel"),
        data: top.map((o) => o.grossQuantity),
        backgroundColor: "#f59e0b",
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

  const monthlySpendTrend = useMemo(() => {
    if (!data || data.monthlyTrend.length === 0) return null;
    return {
      labels: data.monthlyTrend.map((m) => m.label),
      datasets: [{
        label: t("aiCredits.netSpend"),
        data: data.monthlyTrend.map((m) => m.netAmount),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.2)",
        fill: true,
        tension: 0.3,
      }],
    };
  }, [data, t]);

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
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

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

  return (
    <div ref={reportRef} className="space-y-6">
      <ConfigurationBanner />
      <PageHeader
        title={t("aiCredits.title")}
        subtitle={t("aiCredits.subtitle")}
        actions={<PdfButton />}
      />
      <DataSourceBanner sourceLabel="GitHub AI Credit Billing API (/settings/billing/ai_credit/usage) + Copilot Usage/PR overlays" live />

      <div className="rounded-lg border border-indigo-100 bg-indigo-50 p-3 text-xs text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">
        {t("aiCredits.ubbNotice")}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => goMonth(-1)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ← {t("aiCredits.prev")}
        </button>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          onClick={() => goMonth(1)}
          disabled={year === now.getFullYear() && month === now.getMonth() + 1}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t("aiCredits.next")} →
        </button>
      </div>

      <Card title={t("aiCredits.filtersTitle")} subtitle={t("aiCredits.filtersDesc")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
          <SelectFilter
            label={t("aiCredits.model")}
            allLabel={t("common.all")}
            value={modelFilter}
            onChange={setModelFilter}
            options={data.filters.options.models.map((v) => ({ value: v, label: v }))}
          />
          <SelectFilter
            label={t("aiCredits.costCenter")}
            allLabel={t("common.all")}
            value={costCenterFilter}
            onChange={setCostCenterFilter}
            options={data.filters.options.costCenters.map((v) => ({ value: v, label: v }))}
          />
          <SelectFilter
            label={t("aiCredits.organization")}
            allLabel={t("common.all")}
            value={orgFilter}
            onChange={setOrgFilter}
            options={data.filters.options.orgs.map((v) => ({ value: v, label: v }))}
          />
          <SelectFilter
            label={t("aiCredits.user")}
            allLabel={t("common.all")}
            value={userFilter}
            onChange={setUserFilter}
            options={data.filters.options.users.map((u) => ({ value: u.login, label: u.displayLabel }))}
          />
          <SelectFilter
            label={t("aiCredits.team")}
            allLabel={t("common.all")}
            value={teamFilter}
            onChange={setTeamFilter}
            options={data.filters.options.teams.map((v) => ({ value: v, label: v }))}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("aiCredits.grossCredits")} value={fmtNum(totals.grossCredits)} />
        <Kpi label={t("aiCredits.includedCredits")} value={fmtNum(totals.includedCredits)} color="text-green-600" />
        <Kpi label={t("aiCredits.billableCredits")} value={fmtNum(totals.billableCredits)} color={totals.billableCredits > 0 ? "text-indigo-600" : "text-gray-900"} />
        <Kpi label={t("aiCredits.netAmount")} value={fmt$(totals.netAmount)} color={totals.netAmount > 0 ? "text-indigo-600" : "text-gray-900"} />
        <Kpi label={t("aiCredits.discountCoverage")} value={`${totals.discountCoveragePct}%`} color={totals.discountCoveragePct >= 80 ? "text-green-600" : totals.discountCoveragePct >= 50 ? "text-amber-600" : "text-indigo-600"} />
        <Kpi label={t("aiCredits.creditsPerSeat")} value={fmtNum(totals.creditsPerSeat)} />
      </div>

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
          {monthlySpendTrend ? (
            <div className="h-[280px]"><Line data={monthlySpendTrend} options={{ ...barOpts, maintainAspectRatio: false }} /></div>
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

      {data.perUserBreakdown.length > 0 && (
        <Card title={t("aiCredits.userBreakdown", `${data.perUserBreakdown.length}`)} subtitle={t("aiCredits.userBreakdownDesc")}>
          <DataTable
            columns={[
              { key: "displayLabel", header: t("aiCredits.user"), render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{String(value)}</span> },
              { key: "grossQuantity", header: t("aiCredits.creditsLabel"), align: "right", render: (value: unknown) => fmtNum(Number(value)) },
              { key: "netQuantity", header: t("aiCredits.billableCredits"), align: "right", render: (value: unknown) => fmtNum(Number(value)) },
              { key: "netAmount", header: t("aiCredits.netAmount"), align: "right", render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{fmt$(Number(value))}</span> },
            ]}
            data={(data.perUserBreakdown) as unknown as Record<string, unknown>[]}
            emptyMessage={t("aiCredits.noUserData")}
            searchPlaceholder={t("common.searchUsersEllipsis")}
            pageSize={25}
            defaultSortKey="grossQuantity"
            defaultSortDir="desc"
          />
        </Card>
      )}

      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-300">
        <p className="font-medium">{t("aiCredits.aboutTitle")}</p>
        <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
          {t("aiCredits.aboutBody")}
        </p>
      </div>
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

function SelectFilter({
  label,
  allLabel,
  value,
  onChange,
  options,
}: {
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-gray-600 dark:text-gray-300">
      <span className="font-medium">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-700 shadow-xs focus:border-blue-500 focus:outline-hidden dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      >
        <option value="">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}
