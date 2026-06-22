"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Loader2, AlertCircle, BarChart3, TrendingUp, Users } from "lucide-react";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { PageHeader } from "@/components/layout/page-header";
import { AiInsightPanel } from "@/components/ai/insight-panel";

interface AiStatus {
  enabled: boolean;
  configured: boolean;
}

export default function AiAnalystPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  useEffect(() => {
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then((data: AiStatus) => setStatus(data))
      .catch(() => setStatus({ enabled: false, configured: false }))
      .finally(() => setLoadingStatus(false));
  }, []);

  if (loadingStatus) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  // Feature off or no token → guide to settings.
  if (!status?.enabled || !status?.configured) {
    return (
      <div className="space-y-6">
        <PageHeader title={t("aiAnalyst.title")} subtitle={t("aiAnalyst.subtitle")} />
        <div className="flex flex-col items-center justify-center rounded-lg border border-gray-200 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 rounded-full bg-amber-100 p-4 dark:bg-amber-900/30">
            <AlertCircle className="h-8 w-8 text-amber-500 dark:text-amber-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("aiAnalyst.disabledTitle")}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-gray-500 dark:text-gray-400">
            {t("aiAnalyst.disabledDesc")}
          </p>
          <Link
            href="/settings/ai-analyst"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700"
          >
            <Sparkles className="h-4 w-4" />
            {t("aiAnalyst.openSettings")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t("aiAnalyst.title")} subtitle={t("aiAnalyst.subtitle")} />

      <AiInsightPanel
        kind="executive"
        title={t("aiAnalyst.executive")}
        description={t("aiAnalyst.executiveDesc")}
        icon={BarChart3}
        skipStatusCheck
        defaultOpen
      />

      <AiInsightPanel
        kind="roi_forecast"
        title={t("aiAnalyst.roiForecast")}
        description={t("aiAnalyst.roiForecastDesc")}
        icon={TrendingUp}
        skipStatusCheck
      />

      <AiInsightPanel
        kind="team_scorecards"
        title={t("aiAnalyst.teamScorecards")}
        description={t("aiAnalyst.teamScorecardsDesc")}
        icon={Users}
        skipStatusCheck
      />
    </div>
  );
}
