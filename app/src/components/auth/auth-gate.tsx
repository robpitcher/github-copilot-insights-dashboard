"use client";

import { useEffect, useState } from "react";
import { Lock, Loader2, AlertCircle } from "lucide-react";
import { GithubIcon } from "@/components/icons/github-icon";
import { useTranslation } from "@/lib/i18n/locale-provider";

/**
 * Global authentication gate. When DASHBOARD_PASSWORD is set on the server,
 * every page is protected behind a password prompt. If the env var is
 * not set the gate is transparent and children render immediately.
 *
 * This is separate from the admin password (ADMIN_PASSWORD) which
 * protects the Settings pages.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<"checking" | "open" | "locked" | "signin" | "authenticated">("checking");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolveAuth() {
      try {
        // Identity mode (GitHub OAuth) takes precedence, mirroring the proxy:
        // an unauthenticated user is shown a sign-in gate rather than the app.
        const sessionRes = await fetch("/api/auth/session");
        if (sessionRes.ok) {
          const session = (await sessionRes.json()) as {
            identityMode: boolean;
            authenticated: boolean;
          };
          if (session.identityMode) {
            if (!cancelled) setStatus(session.authenticated ? "authenticated" : "signin");
            return;
          }
        }

        // Shared-password mode: gate on DASHBOARD_PASSWORD.
        const res = await fetch("/api/auth/verify-dashboard");
        if (!res.ok) throw new Error("Failed to check auth");
        const data = (await res.json()) as { required: boolean };
        if (cancelled) return;
        if (!data.required) {
          setStatus("open");
        } else if (typeof window !== "undefined" && sessionStorage.getItem("dashboard_authenticated") === "true") {
          setStatus("authenticated");
        } else {
          setStatus("locked");
        }
      } catch {
        // If auth checks fail, allow access (fail-open for usability).
        if (!cancelled) setStatus("open");
      }
    }

    resolveAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/auth/verify-dashboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        sessionStorage.setItem("dashboard_authenticated", "true");
        setStatus("authenticated");
      } else {
        const data = await res.json();
        setError(data.error ?? t("auth.invalidPassword"));
      }
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setVerifying(false);
    }
  };

  if (status === "checking") {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <svg className="h-10 w-10 animate-spin text-blue-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-gray-500 dark:text-gray-400">{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  if (status === "open" || status === "authenticated") {
    return <>{children}</>;
  }

  if (status === "signin") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-4 flex items-center gap-2">
            <GithubIcon className="h-5 w-5 text-gray-900 dark:text-gray-100" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("auth.signInTitle")}</h2>
          </div>
          <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
            {t("auth.signInPrompt")}
          </p>
          <a
            href="/api/auth/github/login"
            className="flex w-full items-center justify-center gap-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            <GithubIcon className="h-4 w-4" />
            {t("auth.signInWithGitHub")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex items-center gap-2">
          <Lock className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{t("auth.dashboardAccess")}</h2>
        </div>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {t("auth.dashboardPrompt")}
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.password")}
            autoFocus
            className="mb-3 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-xs focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            autoComplete="off"
          />
          {error && (
            <p className="mb-3 flex items-center gap-1 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" />
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={!password.trim() || verifying}
            className="w-full rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {verifying ? (
              <Loader2 className="mx-auto h-4 w-4 animate-spin" />
            ) : (
              t("auth.unlock")
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
