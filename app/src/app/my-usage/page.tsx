"use client";

import { useEffect, useMemo, useState } from "react";
import "@/lib/chart-registry";
import { Bar, Line } from "react-chartjs-2";
import { useChartOptions } from "@/lib/theme/chart-theme";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { PageHeader } from "@/components/layout/page-header";
import { ReportBanner } from "@/components/layout/report-banner";
import { DataTable } from "@/components/ui/data-table";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { ConfigurationBanner } from "@/components/layout/configuration-banner";
import { DataSourceBanner } from "@/components/layout/report-filters";

interface CreditBucket {
  grossQuantity: number;
  discountQuantity: number;
  netQuantity: number;
  grossAmount: number;
  discountAmount: number;
  netAmount: number;
}

interface MyUsageTotals {
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

interface MonthlyTrendPoint {
  year: number;
  month: number;
  label: string;
  grossCredits: number;
  billableCredits: number;
  grossAmount: number;
  netAmount: number;
}

interface AiCreditData {
  period: { year: number; month: number };
  totals: MyUsageTotals;
  perModelBreakdown: ModelBreakdown[];
  monthlyTrend: MonthlyTrendPoint[];
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

function fmt$(v: number) {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(v: number) {
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export default function MyUsagePage() {
  const { commonOptions: barOpts } = useChartOptions();
  const { t } = useTranslation();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [data, setData] = useState<AiCreditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setNotConfigured(false);

    // Identity is implicit: no `user` param is sent. The server forces the
    // scope to the signed-in developer's own login (issue C1), so this page
    // can never read another user's rows.
    const params = new URLSearchParams({ year: String(year), month: String(month) });

    fetch(`/api/metrics/ai-credits?${params.toString()}`)
      .then(async (res) => {
        if (res.status === 400) {
          setNotConfigured(true);
          return null;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json() as Promise<AiCreditData>;
      })
      .then((credits) => setData(credits))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [year, month]);

  const modelBar = useMemo(() => {
    if (!data || data.perModelBreakdown.length === 0) return null;
    const top = data.perModelBreakdown.slice(0, 15);
    return {
      labels: top.map((m) => m.model),
      datasets: [{
        label: t("myUsage.creditsLabel"),
        data: top.map((m) => m.grossQuantity),
        backgroundColor: top.map((_, i) => MODEL_COLORS[i % MODEL_COLORS.length]),
        borderRadius: 6,
      }],
    };
  }, [data, t]);

  const trendLine = useMemo(() => {
    if (!data || data.monthlyTrend.length === 0) return null;
    return {
      labels: data.monthlyTrend.map((m) => m.label),
      datasets: [{
        label: t("myUsage.netSpend"),
        data: data.monthlyTrend.map((m) => m.netAmount),
        borderColor: "#6366f1",
        backgroundColor: "rgba(99,102,241,0.2)",
        fill: true,
        tension: 0.3,
      }],
    };
  }, [data, t]);

  const goMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setYear(y);
    setMonth(m);
  };

  if (loading) {
    return <LoadingSpinner message={t("myUsage.loading")} />;
  }

  if (notConfigured) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ConfigurationBanner />
        <EmptyState isConfigured={false} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <ConfigurationBanner />
        <EmptyState hasData={false} />
      </div>
    );
  }

  if (!data) return null;

  const { totals } = data;
  const hasUsage = data.perModelBreakdown.length > 0 || totals.grossCredits > 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <ConfigurationBanner />
      <PageHeader title={t("myUsage.title")} subtitle={t("myUsage.subtitle")} />
      <DataSourceBanner sourceLabel="GitHub AI Credit Billing report export (scoped to your login)" />
      <ReportBanner title={t("myUsage.aboutTitle")} body={t("myUsage.aboutBody")} />

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => goMonth(-1)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          ← {t("myUsage.prev")}
        </button>
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
          {MONTH_NAMES[month - 1]} {year}
        </span>
        <button
          onClick={() => goMonth(1)}
          disabled={year === now.getFullYear() && month === now.getMonth() + 1}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          {t("myUsage.next")} →
        </button>
      </div>

      {hasUsage ? (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kpi label={t("myUsage.grossCredits")} value={fmtNum(totals.grossCredits)} />
            <Kpi label={t("myUsage.includedCredits")} value={fmtNum(totals.includedCredits)} color="text-green-600" />
            <Kpi label={t("myUsage.billableCredits")} value={fmtNum(totals.billableCredits)} color={totals.billableCredits > 0 ? "text-indigo-600" : "text-gray-900"} />
            <Kpi label={t("myUsage.netAmount")} value={fmt$(totals.netAmount)} color={totals.netAmount > 0 ? "text-indigo-600" : "text-gray-900"} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title={t("myUsage.byModel")} subtitle={t("myUsage.byModelDesc")}>
              {modelBar ? (
                <div className="h-[280px]"><Bar data={modelBar} options={barOpts} /></div>
              ) : (
                <p className="py-8 text-center text-sm text-gray-400">{t("myUsage.noModelData")}</p>
              )}
            </Card>
            <Card title={t("myUsage.trendTitle")} subtitle={t("myUsage.trendDesc")}>
              {trendLine ? (
                <div className="h-[280px]"><Line data={trendLine} options={{ ...barOpts, maintainAspectRatio: false }} /></div>
              ) : (
                <p className="py-8 text-center text-sm text-gray-400">{t("myUsage.noTrend")}</p>
              )}
            </Card>
          </div>

          {data.perModelBreakdown.length > 0 && (
            <Card title={t("myUsage.modelBreakdown")} subtitle={t("myUsage.modelBreakdownDesc")}>
              <DataTable
                columns={[
                  { key: "model", header: t("myUsage.model"), render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{String(value)}</span> },
                  { key: "grossQuantity", header: t("myUsage.grossCredits"), align: "right", render: (value: unknown) => fmtNum(Number(value)) },
                  { key: "netQuantity", header: t("myUsage.billableCredits"), align: "right", render: (value: unknown) => fmtNum(Number(value)) },
                  { key: "grossAmount", header: t("myUsage.grossAmount"), align: "right", render: (value: unknown) => fmt$(Number(value)) },
                  { key: "netAmount", header: t("myUsage.netAmount"), align: "right", render: (value: unknown) => <span className="font-medium text-gray-900 dark:text-gray-100">{fmt$(Number(value))}</span> },
                ]}
                data={(data.perModelBreakdown) as unknown as Record<string, unknown>[]}
                emptyMessage={t("myUsage.noModelData")}
                pageSize={25}
                defaultSortKey="grossQuantity"
                defaultSortDir="desc"
              />
            </Card>
          )}
        </>
      ) : (
        <EmptyState hasData={true} />
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
