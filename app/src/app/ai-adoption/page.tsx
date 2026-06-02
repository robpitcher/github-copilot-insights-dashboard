"use client";

import { useState, useCallback, useMemo } from "react";
import "@/lib/chart-registry";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import { DataTable } from "@/components/ui/data-table";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { usePdfExport } from "@/components/ui/pdf-export";
import { useChartOptions } from "@/lib/theme/chart-theme";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { ReportFilters, DataSourceBanner, formatDateRangeLabel, type FilterState, type DataRange } from "@/components/layout/report-filters";
import { ConfigurationBanner } from "@/components/layout/configuration-banner";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/ui/empty-state";

/* ── Types ── */

interface DistributionRow {
  phase: number;
  key: string;
  label: string;
  users: number;
  share: number;
}

interface PerPhaseRow {
  phase: number;
  key: string;
  label: string;
  users: number;
  avgInteractions: number;
  avgCodeGenerated: number;
  avgCodeAccepted: number;
  avgLocAdded: number;
  avgLocDeleted: number;
}

interface AiAdoptionData {
  period: { start: string; end: string };
  kpis: {
    classifiedUsers: number;
    engagedUsers: number;
    codeFirstUsers: number;
    agentFirstUsers: number;
    multiAgentUsers: number;
    noCohortUsers: number;
    multiAgentRate: number;
    agentAdoptionRate: number;
    codeFirstRate: number;
  };
  distribution: DistributionRow[];
  progressionOverTime: Array<Record<string, string | number>>;
  perPhaseMetrics: PerPhaseRow[];
  topUsers: Array<{
    userId: number;
    userLogin: string;
    displayLabel: string;
    phase: number | null;
    phaseKey: string | null;
    phaseLabel: string | null;
    daysActive: number;
    interactions: number;
    codeGenerated: number;
    codeAccepted: number;
    locAdded: number;
  }>;
}

/* ── Helpers ── */

// Phase colors: no cohort (grey), code-first (blue), agent-first (violet), multi-agent (green).
const PHASE_COLORS: Record<string, string> = {
  noCohort: "#94a3b8",
  codeFirst: "#3b82f6",
  agentFirst: "#8b5cf6",
  multiAgent: "#22c55e",
};
const PHASE_ORDER = ["noCohort", "codeFirst", "agentFirst", "multiAgent"];

function fmtDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── Component ── */

export default function AiAdoptionPage() {
  const { commonOptions, doughnutOptions, legendPreset } = useChartOptions();
  const { t } = useTranslation();
  const [data, setData] = useState<AiAdoptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [appliedFilters, setAppliedFilters] = useState<FilterState | null>(null);
  const [dataRange, setDataRange] = useState<DataRange | null>(null);
  const { ref: reportRef, ExportButton: PdfButton } = usePdfExport("copilot-ai-adoption");

  const fetchData = useCallback(async (filters: FilterState) => {
    setAppliedFilters(filters);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.startDate) params.set("start", filters.startDate);
      if (filters.endDate) params.set("end", filters.endDate);
      if (filters.userId) params.set("userId", filters.userId);
      if (filters.orgId) params.set("orgId", filters.orgId);
      if (filters.teamId) params.set("teamId", filters.teamId);
      const res = await fetch(`/api/metrics/ai-adoption?${params}`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error("Failed to fetch AI adoption data:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const kpi = data?.kpis;

  const phaseLabel = useCallback(
    (key: string | null, fallback: string | null) =>
      key ? t(`aiAdoption.phase.${key}`) || fallback || key : fallback || "—",
    [t],
  );

  /* ── Chart data (memoized) ── */

  const distributionDonut = useMemo(() => {
    if (!data) return null;
    const rows = data.distribution;
    return {
      labels: rows.map((r) => phaseLabel(r.key, r.label)),
      datasets: [{
        data: rows.map((r) => r.users),
        backgroundColor: rows.map((r) => PHASE_COLORS[r.key] ?? "#64748b"),
        borderWidth: 0,
      }],
    };
  }, [data, phaseLabel]);

  const progressionChart = useMemo(() => {
    if (!data) return null;
    const rows = data.progressionOverTime;
    if (rows.length === 0) return null;
    return {
      labels: rows.map((r) => fmtDate(String(r.date))),
      datasets: PHASE_ORDER.map((key) => ({
        label: phaseLabel(key, key),
        data: rows.map((r) => Number(r[key]) || 0),
        borderColor: PHASE_COLORS[key],
        backgroundColor: PHASE_COLORS[key],
        fill: true,
        tension: 0.3,
        pointRadius: 1,
      })),
    };
  }, [data, phaseLabel]);

  const perPhaseInteractionsChart = useMemo(() => {
    if (!data) return null;
    const rows = data.perPhaseMetrics;
    return {
      labels: rows.map((r) => phaseLabel(r.key, r.label)),
      datasets: [{
        label: t("aiAdoption.avgInteractions"),
        data: rows.map((r) => r.avgInteractions),
        backgroundColor: rows.map((r) => PHASE_COLORS[r.key] ?? "#64748b"),
        borderRadius: 4,
      }],
    };
  }, [data, phaseLabel, t]);

  /* ── Option presets ── */

  const barOpts = { ...commonOptions };

  const stackedAreaOpts = (showLegend = true) => ({
    ...commonOptions,
    plugins: { ...commonOptions.plugins, legend: { ...legendPreset, display: showLegend } },
    scales: {
      ...commonOptions.scales,
      y: { ...commonOptions.scales.y, stacked: true },
    },
  });

  return (
    <div ref={reportRef} className="space-y-6">
      <ConfigurationBanner />
      <PageHeader
        title={t("aiAdoption.title")}
        subtitle={`${t("aiAdoption.subtitle")}${appliedFilters ? ` — ${formatDateRangeLabel(appliedFilters.startDate, appliedFilters.endDate)}` : ""}`}
        actions={<PdfButton />}
      />
      <ReportFilters onApply={fetchData} onDataRange={setDataRange} />
      <DataSourceBanner />

      {loading && !data ? (
        <LoadingSpinner message={t("aiAdoption.loading")} />
      ) : !data || data.kpis.classifiedUsers === 0 ? (
        <EmptyState hasData={!!dataRange?.lastSyncAt} />
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label={t("aiAdoption.codeFirstUsers")} value={kpi?.codeFirstUsers ?? 0} sub={t("aiAdoption.ofEngaged", kpi?.engagedUsers ?? 0)} />
            <Kpi label={t("aiAdoption.agentFirstUsers")} value={kpi?.agentFirstUsers ?? 0} sub={t("aiAdoption.ofEngaged", kpi?.engagedUsers ?? 0)} />
            <Kpi label={t("aiAdoption.multiAgentUsers")} value={kpi?.multiAgentUsers ?? 0} sub={t("aiAdoption.ofEngaged", kpi?.engagedUsers ?? 0)} />
            <Kpi label={t("aiAdoption.agentAdoptionRate")} value={`${kpi?.agentAdoptionRate ?? 0}%`} sub={t("aiAdoption.agentAdoptionRateDesc")} />
          </div>

          {/* Distribution donut + current breakdown */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={t("aiAdoption.distribution")} subtitle={t("aiAdoption.distributionDesc")}>
              {distributionDonut && <div className="h-[320px]"><Doughnut data={distributionDonut} options={doughnutOptions} /></div>}
            </Card>
            <Card title={t("aiAdoption.cohortBreakdown")} subtitle={t("aiAdoption.cohortBreakdownDesc")}>
              <DataTable
                columns={[
                  { key: "label", header: t("aiAdoption.cohort"), render: (_value: unknown, row: Record<string, unknown>) => <span className="font-medium text-gray-900 dark:text-gray-100">{phaseLabel(String(row.key), String(row.label))}</span> },
                  { key: "users", header: t("aiAdoption.users"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                  { key: "share", header: t("aiAdoption.share"), align: "right", render: (value: unknown) => `${Number(value)}%` },
                ]}
                data={(data?.distribution ?? []) as unknown as Record<string, unknown>[]}
                emptyMessage={t("common.noResults")}
                pageSize={10}
                defaultSortKey="phase"
              />
            </Card>
          </div>

          {/* Progression over time — stacked area */}
          <Card title={t("aiAdoption.progression")} subtitle={t("aiAdoption.progressionDesc")}>
            {progressionChart ? (
              <div className="h-[340px]"><Line data={progressionChart} options={stackedAreaOpts()} /></div>
            ) : (
              <div className="flex h-[300px] items-center justify-center text-sm text-gray-400">{t("common.noResults")}</div>
            )}
          </Card>

          {/* Avg interactions per cohort */}
          <Card title={t("aiAdoption.avgInteractionsByCohort")} subtitle={t("aiAdoption.avgInteractionsByCohortDesc")}>
            {perPhaseInteractionsChart && <div className="h-[300px]"><Bar data={perPhaseInteractionsChart} options={barOpts} /></div>}
          </Card>

          {/* Per-phase metrics table */}
          <Card title={t("aiAdoption.perCohortMetrics")} subtitle={t("aiAdoption.perCohortMetricsDesc")}>
            <DataTable
              columns={[
                { key: "label", header: t("aiAdoption.cohort"), render: (_value: unknown, row: Record<string, unknown>) => <span className="font-medium text-gray-900 dark:text-gray-100">{phaseLabel(String(row.key), String(row.label))}</span> },
                { key: "users", header: t("aiAdoption.users"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                { key: "avgInteractions", header: t("aiAdoption.avgInteractions"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                { key: "avgCodeGenerated", header: t("aiAdoption.avgCodeGenerated"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                { key: "avgCodeAccepted", header: t("aiAdoption.avgCodeAccepted"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                { key: "avgLocAdded", header: t("aiAdoption.avgLocAdded"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
              ]}
              data={(data?.perPhaseMetrics ?? []) as unknown as Record<string, unknown>[]}
              emptyMessage={t("common.noResults")}
              pageSize={10}
              defaultSortKey="phase"
            />
          </Card>

          {/* Top users with current cohort */}
          <Card title={t("aiAdoption.topUsers")} subtitle={t("aiAdoption.topUsersDesc")}>
            <DataTable
              columns={[
                { key: "displayLabel", header: t("common.user"), render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{String(value)}</span> },
                { key: "phaseKey", header: t("aiAdoption.currentCohort"), render: (_value: unknown, row: Record<string, unknown>) => phaseLabel(row.phaseKey as string | null, row.phaseLabel as string | null) },
                { key: "daysActive", header: t("aiAdoption.daysActive"), align: "right" },
                { key: "interactions", header: t("aiAdoption.interactions"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                { key: "codeGenerated", header: t("aiAdoption.codeGenerated"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
                { key: "codeAccepted", header: t("aiAdoption.codeAccepted"), align: "right", render: (value: unknown) => Number(value).toLocaleString() },
              ]}
              data={(data?.topUsers ?? []) as unknown as Record<string, unknown>[]}
              emptyMessage={t("common.noResults")}
              searchPlaceholder={t("aiAdoption.searchUsers")}
              pageSize={25}
              defaultSortKey="displayLabel"
            />
          </Card>
        </>
      )}
    </div>
  );
}

/* ── Sub-components ── */

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

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-xs dark:border-gray-700 dark:bg-gray-800">
      <p className="text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
        {typeof value === "number" ? value.toLocaleString() : value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
    </div>
  );
}
