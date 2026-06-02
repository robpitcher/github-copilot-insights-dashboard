"use client";

import { useEffect, useMemo, useState } from "react";
import "@/lib/chart-registry";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { useChartOptions } from "@/lib/theme/chart-theme";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { PageHeader } from "@/components/layout/page-header";
import { ReportBanner } from "@/components/layout/report-banner";
import { DataTable } from "@/components/ui/data-table";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePdfExport } from "@/components/ui/pdf-export";
import { ConfigurationBanner } from "@/components/layout/configuration-banner";
import { DataSourceBanner } from "@/components/layout/report-filters";
import { AlertTriangle, Settings } from "lucide-react";
import Link from "next/link";

interface PremiumTotals {
  totalPremiumRequests: number;
  includedQuota: number;
  includedUsed: number;
  overage: number;
  grossAmount: number;
  netAmount: number;
}

interface ModelBreakdown {
  sku: string;
  grossQuantity: number;
  grossAmount: number;
  netAmount: number;
}

interface UserBreakdown {
  user: string;
  displayLabel: string;
  grossQuantity: number;
  grossAmount: number;
  netAmount: number;
}

interface OrgBreakdown {
  org: string;
  grossQuantity: number;
  grossAmount: number;
  netAmount: number;
}

interface TeamBreakdown {
  team: string;
  grossQuantity: number;
  grossAmount: number;
  netAmount: number;
}

interface DailyTrendPoint {
  date: string;
  grossQuantity: number;
  grossAmount: number;
  netAmount: number;
}

interface MonthlyTrendPoint {
  year: number;
  month: number;
  label: string;
  requests: number;
  grossAmount: number;
  netAmount: number;
}

interface ChangeVsPrevious {
  requestsDelta: number;
  requestsDeltaPct: number | null;
  netAmountDelta: number;
  netAmountDeltaPct: number | null;
}

interface PremiumData {
  period: { year: number; month: number };
  totals: PremiumTotals;
  seats: { total: number; planCounts: Record<string, number> };
  filters: {
    options: {
      models: string[];
      orgs: string[];
      users: Array<{ login: string; displayLabel: string }>;
      teams: string[];
    };
    selected: { model: string; org: string; user: string; team: string };
  };
  perModelBreakdown: ModelBreakdown[];
  perUserBreakdown: UserBreakdown[];
  perOrgBreakdown: OrgBreakdown[];
  perTeamBreakdown: TeamBreakdown[];
  dailyTrend: DailyTrendPoint[];
  monthlyTrend: MonthlyTrendPoint[];
  changeVsPrevious: ChangeVsPrevious | null;
}

interface DashboardOverlay {
  kpis?: {
    totalCodeAccept?: number;
  };
}

interface PullRequestsOverlay {
  totals?: {
    totalMerged?: number;
    totalReviewed?: number;
  };
}

function fmt$(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(v: number) {
  return v.toLocaleString("en-US");
}

function fmtDelta(v: number, unit = "") {
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toLocaleString("en-US")}${unit}`;
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

export default function PremiumRequestsPage() {
  const { commonOptions: barOpts, doughnutOptions: doughnutOpts } = useChartOptions();
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [modelFilter, setModelFilter] = useState("");
  const [orgFilter, setOrgFilter] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [data, setData] = useState<PremiumData | null>(null);
  const [dashboardOverlay, setDashboardOverlay] = useState<DashboardOverlay | null>(null);
  const [prOverlay, setPrOverlay] = useState<PullRequestsOverlay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { ref: reportRef, ExportButton: PdfButton } = usePdfExport("copilot-premium-requests");

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

    Promise.all([
      fetch(`/api/metrics/premium-requests?${params.toString()}`).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<PremiumData>;
      }),
      fetch(`/api/metrics/dashboard?start=${start}&end=${end}`).then(async (res) => (res.ok ? res.json() as Promise<DashboardOverlay> : null)),
      fetch(`/api/metrics/pull-requests?start=${start}&end=${end}`).then(async (res) => (res.ok ? res.json() as Promise<PullRequestsOverlay> : null)),
    ])
      .then(([premium, dashboard, prs]) => {
        setData(premium);
        setDashboardOverlay(dashboard);
        setPrOverlay(prs);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month, modelFilter, orgFilter, userFilter, teamFilter]);

  useEffect(() => {
    if (!data) return;
    const { options } = data.filters;
    if (modelFilter && !options.models.includes(modelFilter)) setModelFilter("");
    if (orgFilter && !options.orgs.includes(orgFilter)) setOrgFilter("");
    if (userFilter && !options.users.some((u) => u.login === userFilter)) setUserFilter("");
    if (teamFilter && !options.teams.includes(teamFilter)) setTeamFilter("");
  }, [data, modelFilter, orgFilter, userFilter, teamFilter]);

  const includedVsOverageDonut = useMemo(() => {
    if (!data) return null;
    const { includedUsed, overage, includedQuota } = data.totals;
    const remaining = Math.max(0, includedQuota - includedUsed);
    return {
      labels: ["Consumed PRUs", "Remaining PRUs", "Additional Usage"],
      datasets: [{
        data: [includedUsed, remaining, overage],
        backgroundColor: ["#22c55e", "#d1fae5", "#6366f1"],
        borderWidth: 0,
      }],
    };
  }, [data]);

  const modelBar = useMemo(() => {
    if (!data || data.perModelBreakdown.length === 0) return null;
    const top = data.perModelBreakdown.slice(0, 15);
    return {
      labels: top.map((m) => m.sku),
      datasets: [{
        label: "Premium Requests",
        data: top.map((m) => m.grossQuantity),
        backgroundColor: top.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
        borderRadius: 6,
      }],
    };
  }, [data]);

  const orgBar = useMemo(() => {
    if (!data || data.perOrgBreakdown.length === 0) return null;
    const top = data.perOrgBreakdown.slice(0, 12);
    return {
      labels: top.map((o) => o.org),
      datasets: [{
        label: "Premium Requests",
        data: top.map((o) => o.grossQuantity),
        backgroundColor: "#6366f1",
        borderRadius: 6,
      }],
    };
  }, [data]);

  const teamBar = useMemo(() => {
    if (!data || data.perTeamBreakdown.length === 0) return null;
    const top = data.perTeamBreakdown.slice(0, 12);
    return {
      labels: top.map((o) => o.team),
      datasets: [{
        label: "Premium Requests",
        data: top.map((o) => o.grossQuantity),
        backgroundColor: "#f59e0b",
        borderRadius: 6,
      }],
    };
  }, [data]);

  const dailyCostTrend = useMemo(() => {
    if (!data || data.dailyTrend.length === 0) return null;
    return {
      labels: data.dailyTrend.map((d) => d.date.slice(8, 10)),
      datasets: [
        {
          type: "bar" as const,
          label: "Requests",
          data: data.dailyTrend.map((d) => d.grossQuantity),
          yAxisID: "y",
          backgroundColor: "#6366f1",
          borderRadius: 4,
        },
        {
          type: "line" as const,
          label: "Net Spend ($)",
          data: data.dailyTrend.map((d) => Number(d.netAmount.toFixed(2))),
          yAxisID: "y1",
          borderColor: "#6366f1",
          backgroundColor: "#6366f1",
          tension: 0.25,
          pointRadius: 2,
        },
      ],
    };
  }, [data]);

  const monthlySpendTrend = useMemo(() => {
    if (!data || data.monthlyTrend.length === 0) return null;
    return {
      labels: data.monthlyTrend.map((m) => m.label),
      datasets: [{
        label: "Net Spend ($)",
        data: data.monthlyTrend.map((m) => m.netAmount),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.2)",
        fill: true,
        tension: 0.3,
      }],
    };
  }, [data]);

  // ── Top spend drivers horizontal bar (Executive Summary) ──
  const topDriversBar = useMemo(() => {
    if (!data || data.perModelBreakdown.length === 0) return null;
    const top = data.perModelBreakdown.slice(0, 5);
    return {
      labels: top.map((d) => d.sku),
      datasets: [{
        label: "Net Spend ($)",
        data: top.map((d) => d.netAmount),
        backgroundColor: ["#8b5cf6", "#a855f7", "#6366f1", "#3b82f6", "#14b8a6"],
        borderRadius: 6,
      }],
    };
  }, [data]);

  // ── Change vs Previous month comparison bar ──
  const changeComparisonBar = useMemo(() => {
    if (!data || !data.changeVsPrevious) return null;
    const prev = data.totals.totalPremiumRequests - data.changeVsPrevious.requestsDelta;
    const prevSpend = data.totals.netAmount - data.changeVsPrevious.netAmountDelta;
    return {
      labels: ["Requests", "Net Spend ($)"],
      datasets: [
        {
          label: "Previous Month",
          data: [prev, Number(prevSpend.toFixed(2))],
          backgroundColor: "#cbd5e1",
          borderRadius: 6,
        },
        {
          label: "Current Month",
          data: [data.totals.totalPremiumRequests, Number(data.totals.netAmount.toFixed(2))],
          backgroundColor: "#6366f1",
          borderRadius: 6,
        },
      ],
    };
  }, [data]);

  // ── Budget burn-down doughnut ──
  const budgetBurnDonut = useMemo(() => {
    if (!data) return null;
    const { includedUsed, includedQuota, overage } = data.totals;
    const remaining = Math.max(0, includedQuota - includedUsed);
    return {
      labels: ["Consumed PRUs", "Remaining PRUs", "Additional Usage"],
      datasets: [{
        data: [includedUsed, remaining, overage],
        backgroundColor: ["#6366f1", "#e0e7ff", "#f59e0b"],
        borderWidth: 0,
      }],
    };
  }, [data]);

  // ── Efficiency metrics horizontal bar ──
  const efficiencyBar = useMemo(() => {
    if (!data) return null;
    const ca = dashboardOverlay?.kpis?.totalCodeAccept ?? 0;
    const mp = prOverlay?.totals?.totalMerged ?? 0;
    const rp = prOverlay?.totals?.totalReviewed ?? 0;
    const costAccept = ca > 0 ? Number((data.totals.netAmount / ca).toFixed(2)) : 0;
    const costMerge = mp > 0 ? Number((data.totals.netAmount / mp).toFixed(2)) : 0;
    const costReview = rp > 0 ? Number((data.totals.netAmount / rp).toFixed(2)) : 0;
    return {
      labels: ["Per Accepted Generation", "Per Merged PR", "Per Reviewed PR"],
      datasets: [{
        label: "Cost ($)",
        data: [costAccept, costMerge, costReview],
        backgroundColor: ["#22c55e", "#3b82f6", "#f59e0b"],
        borderRadius: 6,
      }],
    };
  }, [data, dashboardOverlay, prOverlay]);

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  if (loading) {
    return <LoadingSpinner message={t("premiumRequests.loadingPremium")} />;
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
  const utilizationPct = totals.includedQuota > 0
    ? Math.round((totals.totalPremiumRequests / totals.includedQuota) * 100)
    : 0;
  const overagePct = totals.totalPremiumRequests > 0
    ? Math.round((totals.overage / totals.totalPremiumRequests) * 100)
    : 0;

  const lastTrendDay = data.dailyTrend[data.dailyTrend.length - 1]?.date;
  const elapsedDays = lastTrendDay ? Number(lastTrendDay.slice(8, 10)) : 0;
  const avgDailyRequests = elapsedDays > 0 ? totals.totalPremiumRequests / elapsedDays : 0;
  const quotaRemaining = Math.max(0, totals.includedQuota - totals.includedUsed);
  const daysToExhaustion = avgDailyRequests > 0 ? Math.ceil(quotaRemaining / avgDailyRequests) : null;

  const currentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const projectedEomSpend = currentMonth && elapsedDays > 0
    ? (totals.netAmount / elapsedDays) * daysInMonth(year, month)
    : totals.netAmount;

  const codeAccepts = dashboardOverlay?.kpis?.totalCodeAccept ?? 0;
  const mergedPrs = prOverlay?.totals?.totalMerged ?? 0;
  const reviewedPrs = prOverlay?.totals?.totalReviewed ?? 0;

  return (
    <div ref={reportRef} className="space-y-6">
      <ConfigurationBanner />
      <PageHeader
        title={t("premiumRequests.title")}
        subtitle={t("premiumRequests.subtitle")}
        actions={<PdfButton />}
      />
      <DataSourceBanner sourceLabel="GitHub Premium Request Billing API + Copilot Usage/PR overlays" live />
      <ReportBanner title={t("premiumRequests.aboutTitle")} body={t("premiumRequests.aboutBody")} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => goMonth(-1)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ← Prev
        </button>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          onClick={() => goMonth(1)}
          disabled={year === now.getFullYear() && month === now.getMonth() + 1}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          Next →
        </button>
      </div>

      <Card title="Drill-down Filters" subtitle="Slice premium usage and spend by model, org, user, and team">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <SelectFilter
            label="Model"
            value={modelFilter}
            onChange={setModelFilter}
            options={data.filters.options.models.map((v) => ({ value: v, label: v }))}
          />
          <SelectFilter
            label="Organization"
            value={orgFilter}
            onChange={setOrgFilter}
            options={data.filters.options.orgs.map((v) => ({ value: v, label: v }))}
          />
          <SelectFilter
            label="User"
            value={userFilter}
            onChange={setUserFilter}
            options={data.filters.options.users.map((u) => ({ value: u.login, label: u.displayLabel }))}
          />
          <SelectFilter
            label="Team"
            value={teamFilter}
            onChange={setTeamFilter}
            options={data.filters.options.teams.map((v) => ({ value: v, label: v }))}
          />
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Kpi label={t("premiumRequests.totalPremiumRequests")} value={fmtNum(totals.totalPremiumRequests)} />
        <Kpi label={t("premiumRequests.includedQuota")} value={fmtNum(totals.includedQuota)} color="text-green-600" />
        <Kpi label={t("premiumRequests.includedUsed")} value={fmtNum(totals.includedUsed)} color="text-green-600" />
        <Kpi label={t("premiumRequests.overagePaid")} value={fmtNum(totals.overage)} color={totals.overage > 0 ? "text-blue-600" : "text-gray-900"} />
        <Kpi label={t("premiumRequests.utilizationLabel")} value={`${utilizationPct}%`} color={utilizationPct > 100 ? "text-blue-600" : utilizationPct > 80 ? "text-amber-600" : "text-green-600"} />
        <Kpi label={t("premiumRequests.overageCost")} value={fmt$(totals.netAmount)} color={totals.netAmount > 0 ? "text-blue-600" : "text-gray-900"} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Executive Summary" subtitle="Usage status, additional usage, and forecast for the selected period">
          <div className="mb-3 grid grid-cols-3 gap-3">
            <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">Total Spend</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt$(totals.netAmount)}</p>
            </div>
            <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">Additional Usage Rate</p>
              <p className="text-lg font-bold text-blue-600 dark:text-blue-400">{overagePct}%</p>
            </div>
            <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
              <p className="text-xs text-gray-500 dark:text-gray-400">EOM Forecast</p>
              <p className="text-lg font-bold text-gray-900 dark:text-gray-100">{fmt$(projectedEomSpend)}</p>
            </div>
          </div>
          {topDriversBar ? (
            <div className="h-[180px]">
              <Bar data={topDriversBar} options={{ ...barOpts, indexAxis: "y" as const, maintainAspectRatio: false, plugins: { ...barOpts.plugins, legend: { display: false } } }} />
            </div>
          ) : (
            <p className="py-4 text-center text-sm text-gray-400">No model driver data available</p>
          )}
          <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">Top spend drivers by model</p>
        </Card>

        <Card title="What Changed (vs previous month)" subtitle="Period-over-period comparison for demand and spend">
          {changeComparisonBar && data.changeVsPrevious ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Requests Change</p>
                  <p className={`text-lg font-bold ${data.changeVsPrevious.requestsDelta >= 0 ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400"}`}>
                    {fmtDelta(data.changeVsPrevious.requestsDelta)}
                    {data.changeVsPrevious.requestsDeltaPct !== null ? ` (${fmtDelta(data.changeVsPrevious.requestsDeltaPct, "%")})` : ""}
                  </p>
                </div>
                <div className="rounded-md bg-gray-50 p-2 text-center dark:bg-gray-700/50">
                  <p className="text-xs text-gray-500 dark:text-gray-400">Spend Change</p>
                  <p className={`text-lg font-bold ${data.changeVsPrevious.netAmountDelta >= 0 ? "text-blue-600 dark:text-blue-400" : "text-green-600 dark:text-green-400"}`}>
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
            <p className="py-8 text-center text-sm text-gray-400">Previous month comparison is not available yet.</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Budget & Burn Tracking" subtitle="Quota burn-down and expected depletion timeline">
          <div className="flex items-center gap-4">
            {budgetBurnDonut && (
              <div className="h-[160px] w-[160px] shrink-0">
                <Doughnut data={budgetBurnDonut} options={{ ...doughnutOpts, cutout: "65%", maintainAspectRatio: false, plugins: { ...doughnutOpts.plugins, legend: { display: false } } }} />
              </div>
            )}
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-indigo-500" />
                <span className="text-gray-600 dark:text-gray-300">Consumed PRUs: <span className="font-medium text-gray-900 dark:text-gray-100">{fmtNum(totals.includedUsed)}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-indigo-200" />
                <span className="text-gray-600 dark:text-gray-300">Remaining PRUs: <span className="font-medium text-gray-900 dark:text-gray-100">{fmtNum(quotaRemaining)}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full bg-amber-500" />
                <span className="text-gray-600 dark:text-gray-300">Additional Usage: <span className="font-medium text-gray-900 dark:text-gray-100">{fmtNum(totals.overage)}</span></span>
              </div>
              <div className="mt-2 border-t border-gray-100 pt-2 dark:border-gray-700">
                <p className="text-xs text-gray-500 dark:text-gray-400">Avg daily: <span className="font-medium">{fmtNum(Math.round(avgDailyRequests))}</span></p>
                <p className="text-xs text-gray-500 dark:text-gray-400">Days to depletion: <span className="font-medium">{daysToExhaustion ?? "N/A"}</span></p>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Efficiency Metrics" subtitle="Cost-to-value overlays from usage and PR outcomes">
          {efficiencyBar ? (
            <>
              <div className="h-[180px]">
                <Bar data={efficiencyBar} options={{ ...barOpts, indexAxis: "y" as const, maintainAspectRatio: false, plugins: { ...barOpts.plugins, legend: { display: false } } }} />
              </div>
              <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400">
                Based on {fmtNum(codeAccepts)} accepted generations, {fmtNum(mergedPrs)} merged PRs, {fmtNum(reviewedPrs)} reviewed PRs
              </p>
            </>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">No overlay data available</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("premiumRequests.includedVsOverage")} subtitle={t("premiumRequests.includedVsOverageDesc")}>
          {includedVsOverageDonut && (
            <div className="h-[280px]"><Doughnut data={includedVsOverageDonut} options={doughnutOpts} /></div>
          )}
        </Card>
        <Card title="Cost Trends (daily)" subtitle="Requests and net spend trend for the selected month">
          {dailyCostTrend ? (
            <div className="h-[280px]"><Bar data={dailyCostTrend as any} options={{
              ...barOpts,
              maintainAspectRatio: false,
              scales: {
                y: { beginAtZero: true, position: "left" as const, title: { display: true, text: "Requests" } },
                y1: { beginAtZero: true, position: "right" as const, grid: { drawOnChartArea: false }, title: { display: true, text: "Net Spend ($)" } },
              },
            }} /></div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">No daily trend data available</p>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Net Spend Trend (6 months)" subtitle="Trailing spend trend for quick anomaly spotting">
          {monthlySpendTrend ? (
            <div className="h-[280px]"><Line data={monthlySpendTrend} options={{ ...barOpts, maintainAspectRatio: false }} /></div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">No monthly trend data available</p>
          )}
        </Card>

        <Card title="Actionable Recommendations" subtitle="Suggested actions to optimize spend and maximize value">
          <ul className="list-inside list-disc space-y-2 text-sm text-gray-700 dark:text-gray-300">
            {totals.overage > 0 && <li>Additional usage observed — consider reviewing team/model-level premium usage policies for optimization.</li>}
            {utilizationPct > 90 && <li>Included quota is well-utilized — consider setting up budget alerts and proactive capacity planning.</li>}
            {data.perTeamBreakdown.length > 0 && data.perTeamBreakdown[0].netAmount > totals.netAmount * 0.35 && (
              <li>Top team accounts for &gt;35% of spend — opportunity to align that team on model guardrails.</li>
            )}
            {data.perModelBreakdown.length > 0 && data.perModelBreakdown[0].netAmount > totals.netAmount * 0.5 && (
              <li>Single model drives majority of spend — explore whether cost-efficient alternatives can serve common workflows.</li>
            )}
            {totals.overage === 0 && utilizationPct <= 90 && (
              <li>Spend is on track — current policies are effective. Continue monitoring month-over-month trends.</li>
            )}
          </ul>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t("premiumRequests.byModel")} subtitle={t("premiumRequests.byModelDesc")}>
          {modelBar ? (
            <div className="h-[280px]"><Bar data={modelBar} options={barOpts} /></div>
          ) : (
            <p className="py-8 text-center text-sm text-gray-400">No model-level data available</p>
          )}
        </Card>
        {orgBar && (
          <Card title={t("premiumRequests.byOrganization")} subtitle={t("premiumRequests.byOrganizationDesc")}>
            <div className="h-[280px]"><Bar data={orgBar} options={barOpts} /></div>
          </Card>
        )}
      </div>

      {teamBar && (
        <Card title="Premium Requests by Team" subtitle="Attribution of premium demand and spend by team">
          <div className="h-[280px]"><Bar data={teamBar} options={barOpts} /></div>
        </Card>
      )}

      <Card title={t("premiumRequests.quotaAllocation")} subtitle={t("premiumRequests.quotaAllocationDesc")}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                <th className="pb-2 pr-4">Plan</th>
                <th className="pb-2 pr-4 text-right">Seats</th>
                <th className="pb-2 pr-4 text-right">PRUs / Seat</th>
                <th className="pb-2 text-right">Total PRUs</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {Object.entries(data.seats.planCounts).map(([plan, count]) => (
                <tr key={plan} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                  <td className="py-2 pr-4 font-medium text-gray-900 capitalize dark:text-gray-100">{plan}</td>
                  <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(count)}</td>
                  <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(PLAN_QUOTAS[plan] ?? 0)}</td>
                  <td className="py-2 text-right font-medium text-gray-900 dark:text-gray-100">{fmtNum((PLAN_QUOTAS[plan] ?? 0) * count)}</td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-2 pr-4 text-gray-900 dark:text-gray-100">Total</td>
                <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(data.seats.total)}</td>
                <td className="py-2 pr-4 text-right text-gray-500 dark:text-gray-400">—</td>
                <td className="py-2 text-right text-green-700 dark:text-green-400">{fmtNum(totals.includedQuota)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {data.perModelBreakdown.length > 0 && (
        <Card title={t("premiumRequests.modelBreakdown")} subtitle={t("premiumRequests.modelBreakdownDesc")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-2 pr-4">Model</th>
                  <th className="pb-2 pr-4 text-right">Requests</th>
                  <th className="pb-2 pr-4 text-right">Gross Amount</th>
                  <th className="pb-2 text-right">Net Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {data.perModelBreakdown.map((m) => (
                  <tr key={m.sku} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="py-2 pr-4 font-medium text-gray-900 dark:text-gray-100">{m.sku}</td>
                    <td className="py-2 pr-4 text-right text-gray-700 dark:text-gray-300">{fmtNum(m.grossQuantity)}</td>
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
        <Card title={`User breakdown (${data.perUserBreakdown.length})`} subtitle="Premium request consumption per user">
          <DataTable
            columns={[
              { key: "displayLabel", header: "User", render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{String(value)}</span> },
              { key: "grossQuantity", header: "Requests", align: "right", render: (value: unknown) => fmtNum(Number(value)) },
              { key: "grossAmount", header: "Gross Amount", align: "right", render: (value: unknown) => fmt$(Number(value)) },
              { key: "netAmount", header: "Net Amount", align: "right", render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{fmt$(Number(value))}</span> },
            ]}
            data={(data.perUserBreakdown) as unknown as Record<string, unknown>[]}
            emptyMessage={t("premiumRequests.noUserData")}
            searchPlaceholder={t("common.searchUsersEllipsis")}
            pageSize={25}
            defaultSortKey="grossQuantity"
            defaultSortDir="desc"
          />
        </Card>
      )}

      <ReportBanner
        title="About premium request billing"
        body="Each Copilot Business seat includes 300 PRUs/month and each Enterprise seat includes 1,000. Usage beyond the included PRUs is billed at $0.04 per request. Data is sourced from GitHub billing usage APIs and enriched with dashboard overlay metrics."
      />
    </div>
  );
}

const PLAN_QUOTAS: Record<string, number> = {
  business: 300,
  enterprise: 1000,
};

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
  value,
  onChange,
  options,
}: {
  label: string;
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
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </label>
  );
}
