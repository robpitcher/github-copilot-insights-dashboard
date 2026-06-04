"use client";

import { useEffect, useState, useCallback } from "react";
import {
  DatabaseZap,
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { getMigrationStatusVariant } from "@/lib/db/migration-status";
import { cn } from "@/lib/utils";

interface MigrationEntry {
  idx: number;
  tag: string;
  when: number;
  status: "applied" | "pending";
  reason?: string;
  expectedHash?: string;
  recordedHash?: string;
}

interface SchemaDrift {
  expectedCount: number;
  missing: { table: string; column: string }[];
  missingTables: string[];
  hasDrift: boolean;
}

interface MigrationStatus {
  migrations: MigrationEntry[];
  appliedCount: number;
  pendingCount: number;
  latestTag: string | null;
  drift: SchemaDrift;
}

function formatTag(tag: string): string {
  // Strip the leading timestamp prefix (e.g. "20260603120000_") for readability.
  const match = tag.match(/^\d+_(.+)$/);
  return match ? match[1].replace(/_/g, " ") : tag;
}

export default function MigrationsPage() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<MigrationStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [result, setResult] = useState<{
    type: "success" | "error";
    message: string;
    logs?: string[];
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/migrate");
      if (res.ok) {
        setStatus(await res.json());
      } else {
        setLoadError(true);
      }
    } catch (err) {
      console.error("Failed to fetch migration status:", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleUpdate = useCallback(async () => {
    setUpdating(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/migrate", { method: "POST" });
      const data = await res.json();
      if (res.ok && data.success) {
        setResult({ type: "success", message: t("migrations.syncSuccess"), logs: data.logs });
      } else {
        setResult({ type: "error", message: data.error ?? t("migrations.syncError"), logs: data.logs });
      }
      await fetchStatus();
    } catch {
      setResult({ type: "error", message: t("migrations.syncError") });
    } finally {
      setUpdating(false);
    }
  }, [t, fetchStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (loadError || !status) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
        {t("migrations.loadError")}
      </div>
    );
  }

  const hasDrift = status.drift.hasDrift;
  const hasPending = status.pendingCount > 0;
  const statusVariant = getMigrationStatusVariant(hasPending, hasDrift);
  const needsUpdate = hasDrift || hasPending;

  return (
    <div className="space-y-6">
      {/* Header + actions */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t("migrations.title")}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("migrations.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchStatus}
            disabled={updating}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            <RefreshCw className="h-4 w-4" />
            {t("migrations.refresh")}
          </button>
          <button
            type="button"
            onClick={handleUpdate}
            disabled={updating}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {updating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <DatabaseZap className="h-4 w-4" />
            )}
            {updating ? t("migrations.updating") : t("migrations.updateToLatest")}
          </button>
        </div>
      </div>

      {/* Result banner */}
      {result && (
        <div
          className={cn(
            "rounded-md border p-3 text-sm",
            result.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300",
          )}
        >
          <div className="flex items-center gap-2 font-medium">
            {result.type === "success" ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {result.message}
          </div>
          {result.logs && result.logs.length > 0 && (
            <ul className="mt-2 space-y-1 pl-6 text-xs opacity-90">
              {result.logs.map((line, i) => (
                <li key={i} className="list-disc">
                  {line}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("migrations.total")}
          </p>
          <p className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">
            {status.migrations.length}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("migrations.applied")}
          </p>
          <p className="mt-1 text-2xl font-semibold text-green-600 dark:text-green-400">
            {status.appliedCount}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("migrations.pending")}
          </p>
          <p
            className={cn(
              "mt-1 text-2xl font-semibold",
              hasPending ? "text-amber-600 dark:text-amber-400" : "text-gray-900 dark:text-gray-100",
            )}
          >
            {status.pendingCount}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("migrations.schemaStatus")}
          </p>
          <p
            className={cn(
              "mt-1 flex items-center gap-1.5 text-sm font-semibold",
              hasPending || hasDrift
                ? "text-amber-600 dark:text-amber-400"
                : "text-green-600 dark:text-green-400",
            )}
          >
            {statusVariant === "pending" ? (
              <>
                <AlertTriangle className="h-4 w-4" />
                {t("migrations.pending")}
              </>
            ) : statusVariant === "drift" ? (
              <>
                <AlertTriangle className="h-4 w-4" />
                {t("migrations.driftDetected")}
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                {t("migrations.inSync")}
              </>
            )}
          </p>
        </div>
      </div>

      {/* Up-to-date banner */}
      {!needsUpdate && (
        <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm font-medium text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4" />
          {t("migrations.allUpToDate")}
        </div>
      )}

      {/* Schema drift detail */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-3 flex items-center gap-2">
          {hasDrift ? (
            <AlertTriangle className="h-5 w-5 text-amber-500" />
          ) : (
            <ShieldCheck className="h-5 w-5 text-green-600 dark:text-green-400" />
          )}
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t("migrations.missingColumns")}
          </h3>
        </div>
        {hasDrift ? (
          <>
            <p className="mb-3 text-sm text-gray-500 dark:text-gray-400">
              {t("migrations.missingColumnsDesc")}
            </p>
            <p className="mb-3 text-xs font-medium text-amber-600 dark:text-amber-400">
              {t(
                "migrations.missingColumnsCount",
                status.drift.missing.length,
                status.drift.expectedCount,
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {status.drift.missing.map((c) => (
                <code
                  key={`${c.table}.${c.column}`}
                  className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                >
                  {c.table}.{c.column}
                </code>
              ))}
            </div>
          </>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("migrations.noMissing")}
          </p>
        )}
      </div>

      {/* Missing tables (catastrophic drift) */}
      {status.drift.missingTables.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
              {t("migrations.missingTables")}
            </h3>
          </div>
          <p className="mb-3 text-sm text-amber-800 dark:text-amber-300">
            {t("migrations.missingTablesDesc")}
          </p>
          <p className="mb-3 text-xs font-medium text-amber-700 dark:text-amber-400">
            {t("migrations.missingTablesCount", status.drift.missingTables.length)}
          </p>
          <div className="flex flex-wrap gap-2">
            {status.drift.missingTables.map((tbl) => (
              <code
                key={tbl}
                className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              >
                {tbl}
              </code>
            ))}
          </div>
        </div>
      )}

      {/* Migration list */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
              <th className="px-4 py-3 w-12">#</th>
              <th className="px-4 py-3">{t("migrations.columnTag")}</th>
              <th className="px-4 py-3">{t("migrations.columnDate")}</th>
              <th className="px-4 py-3 text-right">{t("migrations.columnStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {status.migrations.map((m) => (
              <tr
                key={m.idx}
                className="border-b border-gray-100 last:border-0 dark:border-gray-700/60"
              >
                <td className="px-4 py-2.5 text-gray-400">{m.idx}</td>
                <td className="px-4 py-2.5">
                  <span className="font-medium text-gray-900 dark:text-gray-100">
                    {formatTag(m.tag)}
                  </span>
                  <span className="block font-mono text-xs text-gray-400">{m.tag}</span>
                </td>
                <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">
                  {new Date(m.when).toLocaleDateString()}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <div className="flex flex-col items-end gap-1 text-right">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
                        m.status === "applied"
                          ? "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                          : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                      )}
                    >
                      {m.status === "applied" ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertCircle className="h-3 w-3" />
                      )}
                      {m.status === "applied"
                        ? t("migrations.statusApplied")
                        : t("migrations.statusPending")}
                    </span>
                    {m.reason && (
                      <span className="max-w-xs text-[11px] text-amber-700 dark:text-amber-300">
                        {m.reason}
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
