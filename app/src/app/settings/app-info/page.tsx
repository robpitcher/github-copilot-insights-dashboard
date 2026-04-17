"use client";

import { useEffect, useState, useCallback } from "react";
import { Database, Globe, Shield, Info, Server, Loader2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n/locale-provider";

interface AppInfoData {
  database: {
    status: string;
    host: string;
    name: string;
  };
  enterprise: {
    slug: string | null;
    syncScope: string;
  };
  api: {
    version: string;
  };
  app: {
    version: string;
    buildId: string;
    buildTime: string | null;
  };
  requiredScopes: Array<{
    scope: string;
    description: string;
  }>;
}

export default function AppInfoPage() {
  const { t } = useTranslation();
  const [data, setData] = useState<AppInfoData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInfo = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/app-info");
      if (res.ok) {
        setData(await res.json());
      }
    } catch (err) {
      console.error("Failed to fetch app info:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInfo();
  }, [fetchInfo]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
        Failed to load application info.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("appInfo.title")}
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {t("appInfo.subtitle")}
        </p>
      </div>

      {/* Database Status Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2">
          <Database className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("appInfo.databaseStatus")}
          </h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              Status
            </span>
            <span className="flex items-center gap-2 text-sm font-medium">
              <span
                className={`inline-block h-2.5 w-2.5 rounded-full ${
                  data.database.status === "connected"
                    ? "bg-green-500"
                    : "bg-red-500"
                }`}
              />
              <span
                className={
                  data.database.status === "connected"
                    ? "text-green-700 dark:text-green-400"
                    : "text-red-700 dark:text-red-400"
                }
              >
                {data.database.status === "connected"
                  ? t("appInfo.connected")
                  : t("appInfo.disconnected")}
              </span>
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.databaseHost")}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {data.database.host}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.databaseName")}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {data.database.name}
            </span>
          </div>
        </div>
      </div>

      {/* Enterprise & API Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2">
          <Globe className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("appInfo.enterpriseSlug")} &amp; {t("appInfo.apiVersion")}
          </h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.enterpriseSlug")}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {data.enterprise.slug ?? t("appInfo.notConfigured")}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.syncScope")}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {data.enterprise.syncScope}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.apiVersion")}
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              {data.api.version}
            </span>
          </div>
        </div>
      </div>

      {/* Application Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2">
          <Server className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("appInfo.appVersion")}
          </h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.appVersion")}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {data.app.version}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.buildId")}
            </span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-mono font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              {data.app.buildId}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {t("appInfo.buildTime")}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {data.app.buildTime ?? "—"}
            </span>
          </div>
        </div>
      </div>

      {/* Required Scopes Card */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2">
          <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("appInfo.requiredScopes")}
          </h3>
        </div>
        <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
          {t("appInfo.scopeDescription")}
        </p>
        <ul className="space-y-2">
          {data.requiredScopes.map((s) => (
            <li
              key={s.scope}
              className="flex items-start gap-2 text-sm"
            >
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
              <span>
                <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                  {s.scope}
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  {" — "}{s.description}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
