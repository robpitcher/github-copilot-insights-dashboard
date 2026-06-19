"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Save,
  Trash2,
  CheckCircle,
  XCircle,
  AlertCircle,
  AlertTriangle,
  ShieldCheck,
  Building2,
  Loader2,
} from "lucide-react";
import type { AccessCheckResult, AccessCheckItem, AccessStatus } from "@/lib/github/access-check";
import { TokenField } from "@/components/ui/token-field";

interface SettingState {
  configured: boolean;
  masked?: string;
  value?: string;
}

interface SettingsData {
  settings: {
    github_token: SettingState;
    github_enterprise_slug: SettingState;
  };
}

export default function ConfigurationPage() {
  const [data, setData] = useState<SettingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const [tokenInput, setTokenInput] = useState("");
  const [slugInput, setSlugInput] = useState("");
  const [checking, setChecking] = useState(false);
  const [access, setAccess] = useState<AccessCheckResult | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const settingsRes = await fetch("/api/settings");
      if (settingsRes.ok) {
        const result: SettingsData = await settingsRes.json();
        setData(result);
        if (result.settings.github_enterprise_slug.value) {
          setSlugInput(result.settings.github_enterprise_slug.value);
        }
      }
    } catch (err) {
      console.error("Failed to fetch settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 4000);
  };

  const handleSaveConfig = async () => {
    const token = tokenInput.trim();
    const slug = slugInput.trim();
    const tokenConfigured = data?.settings.github_token.configured ?? false;

    if (!slug) {
      showMessage("error", "Enterprise slug is required");
      return;
    }
    if (!token && !tokenConfigured) {
      showMessage("error", "A GitHub token is required");
      return;
    }

    // Persist the slug always; only update the token when a new value was typed.
    const settings: Array<{ key: string; value: string }> = [
      { key: "github_enterprise_slug", value: slug },
    ];
    if (token) settings.unshift({ key: "github_token", value: token });

    setSaving("config");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (res.ok) {
        showMessage("success", token ? "Token and enterprise slug saved" : "Enterprise slug saved");
        setTokenInput("");
        await fetchSettings();
      } else {
        const err = await res.json();
        showMessage("error", err.error ?? "Failed to save");
      }
    } catch {
      showMessage("error", "Network error");
    } finally {
      setSaving(null);
    }
  };

  const handleCheckAccess = async () => {
    setChecking(true);
    setAccess(null);
    try {
      const res = await fetch("/api/settings/check-access");
      const json = await res.json();
      if (res.ok) {
        setAccess(json as AccessCheckResult);
      } else {
        showMessage("error", json.error ?? "Access check failed");
      }
    } catch {
      showMessage("error", "Network error");
    } finally {
      setChecking(false);
    }
  };

  const handleDelete = async (key: string) => {
    setDeleting(key);
    try {
      const res = await fetch("/api/settings", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      if (res.ok) {
        showMessage("success", "Setting removed.");
        if (key === "github_enterprise_slug") setSlugInput("");
        await fetchSettings();
      } else {
        const err = await res.json();
        showMessage("error", err.error ?? "Failed to delete");
      }
    } catch {
      showMessage("error", "Network error");
    } finally {
      setDeleting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Status message */}
      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${
            message.type === "success"
              ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300"
              : "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300"
          }`}
        >
          {message.type === "success" ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* Info */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <p className="font-medium">How settings are resolved</p>
        <p className="mt-1 text-xs text-blue-700 dark:text-blue-400">
          Configure your GitHub token and enterprise slug, then save both with one button. Settings are stored securely in the database. Use <strong>Check access</strong> to verify which endpoints the token and enterprise can reach.
        </p>
      </div>

      {/* GitHub Connection */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-1 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">GitHub Connection</h2>
          <div className="flex items-center gap-2">
            {data?.settings.github_token.configured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                <CheckCircle className="h-3 w-3" /> Token
              </span>
            )}
            {data?.settings.github_enterprise_slug.configured && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
                <CheckCircle className="h-3 w-3" /> Enterprise
              </span>
            )}
          </div>
        </div>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          Set your token and enterprise slug, then <strong className="text-gray-700 dark:text-gray-300">Save</strong> persists both at once.
        </p>

        {/* Personal Access Token */}
        <label className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Personal Access Token</label>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
          <strong className="text-gray-700 dark:text-gray-300">Classic</strong> (recommended for enterprise):{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">manage_billing:copilot</code>,{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">manage_billing:enterprise</code>,{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">read:enterprise</code>,{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">read:org</code>.{" "}
          <a
            href="https://github.com/settings/tokens/new?scopes=manage_billing:copilot,manage_billing:enterprise,read:enterprise,read:org&description=Copilot+Insights+Dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Generate →
          </a>
          {" · "}
          <strong className="text-gray-700 dark:text-gray-300">Fine-grained</strong> (org-level only): enable{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">GitHub Copilot Business</code> (read).{" "}
          <a
            href="https://github.com/settings/personal-access-tokens/new"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline dark:text-blue-400"
          >
            Generate →
          </a>
        </p>

        <div className="mb-4">
          <TokenField
            value={tokenInput}
            onChange={setTokenInput}
            placeholder={data?.settings.github_token.configured ? "Enter new token to update" : "ghp_xxxxxxxxxxxx"}
            maskedToken={data?.settings.github_token.configured ? data.settings.github_token.masked : null}
            trailing={
              data?.settings.github_token.configured ? (
                <button
                  onClick={() => handleDelete("github_token")}
                  disabled={deleting === "github_token"}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                  title="Remove saved token"
                >
                  {deleting === "github_token" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                </button>
              ) : undefined
            }
          />
        </div>

        {/* Enterprise Slug */}
        <label className="mb-1 block text-xs font-semibold text-gray-700 dark:text-gray-300">Enterprise Slug</label>
        <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
          Found in your enterprise URL: github.com/enterprises/<strong>your-slug</strong>. Leave blank if you only use organization-level tokens.
        </p>
        <div className="mb-4 flex gap-2">
          <input
            type="text"
            value={slugInput}
            onChange={(e) => setSlugInput(e.target.value)}
            placeholder="my-enterprise"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-xs focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          />
          {data?.settings.github_enterprise_slug.configured && (
            <button
              onClick={() => handleDelete("github_enterprise_slug")}
              disabled={deleting === "github_enterprise_slug"}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
              title="Remove saved slug"
            >
              {deleting === "github_enterprise_slug" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            </button>
          )}
        </div>

        {/* Actions — single save for both settings + access check */}
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 dark:border-gray-700">
          <button
            onClick={handleSaveConfig}
            disabled={saving === "config"}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-xs hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving === "config" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </button>
          <button
            onClick={handleCheckAccess}
            disabled={checking || !data?.settings.github_token.configured}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            title={data?.settings.github_token.configured ? "Verify token & enterprise access" : "Save a token first"}
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Check access
          </button>
        </div>
      </div>

      {/* Access check results */}
      {access && <AccessResults result={access} />}

      {/* GitHub APIs Used */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">GitHub APIs Used</h2>
        <p className="mb-4 text-xs text-gray-500 dark:text-gray-400">
          This dashboard calls the following GitHub REST API endpoints. Ensure your PAT has the required scopes.
        </p>
        <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Endpoint</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Purpose</th>
                <th className="w-32 whitespace-nowrap px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">API Version</th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Classic PAT Scopes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/copilot/metrics/reports/users-28-day/latest</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Enterprise user-level usage metrics (28-day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/copilot/metrics/reports/users-1-day</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Enterprise user-level usage metrics (specific day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/copilot/metrics/reports/enterprise-28-day/latest</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Enterprise aggregate metrics including PR summaries (28-day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/copilot/metrics/reports/enterprise-1-day</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Enterprise aggregate metrics including PR summaries (specific day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/copilot/metrics/reports/user-teams-1-day</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Map enterprise users to teams for team attribution</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /orgs/{"{org}"}/copilot/metrics/reports/users-28-day/latest</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Org user-level usage metrics (28-day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code> or <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /orgs/{"{org}"}/copilot/metrics/reports/users-1-day</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Org user-level usage metrics (specific day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code> or <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /orgs/{"{org}"}/copilot/metrics/reports/organization-28-day/latest</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Org aggregate metrics including PR summaries (28-day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code> or <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /orgs/{"{org}"}/copilot/metrics/reports/organization-1-day</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Org aggregate metrics including PR summaries (specific day)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code> or <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /orgs/{"{org}"}/copilot/metrics/reports/user-teams-1-day</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Map org users to teams for team attribution</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code> or <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/copilot/billing/seats</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Copilot seat assignments, license status, and activity</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code> or <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/settings/billing/premium_request/usage</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Premium request billing usage per user (deprecated — historical usage before June 1, 2026 only)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/settings/billing/ai_credit/usage</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">AI Credit billing usage (usage-based billing, activity after June 1, 2026)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:copilot</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /user</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Verify token identity and read granted scopes (Check access)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2 text-gray-400 italic dark:text-gray-500">No scope required (any valid token)</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">POST/GET /enterprises/{"{slug}"}/settings/billing/reports</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">AI Credit usage report export (async; persists per-user rows after June 1, 2026)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">manage_billing:enterprise</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /user/orgs</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Discover organizations accessible to the token</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/organizations</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Discover all organizations in the enterprise</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:enterprise</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /orgs/{"{org}"}/members</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">List organization members (enterprise user discovery)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:org</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/teams</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">List enterprise teams (for team filter)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:enterprise</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /enterprises/{"{slug}"}/teams/{"{team}"}/memberships</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">List enterprise team members (for team filter)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2"><code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">read:enterprise</code></td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">POST /graphql</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Resolve user display names in batches (best-effort)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">GraphQL</td>
                <td className="px-3 py-2 text-gray-400 italic dark:text-gray-500">No scope required</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300">GET /users/{"{login}"}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">Resolve user display names (REST fallback, best-effort)</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">2026-03-10</td>
                <td className="px-3 py-2 text-gray-400 italic dark:text-gray-500">No scope required (public endpoint)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
          All endpoints use <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">Bearer</code> token authentication.
          For full coverage, the recommended classic PAT scopes are:{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">manage_billing:copilot</code>,{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">manage_billing:enterprise</code>,{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">read:enterprise</code>,{" "}
          <code className="rounded-sm bg-gray-100 px-1 dark:bg-gray-700">read:org</code>.
        </p>
      </div>

    </div>
  );
}

function statusIcon(status: AccessStatus) {
  switch (status) {
    case "ok":
      return <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />;
    case "unauthorized":
    case "forbidden":
      return <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />;
    case "not_found":
      return <AlertTriangle className="h-4 w-4 text-amber-500" />;
    default:
      return <AlertCircle className="h-4 w-4 text-gray-400" />;
  }
}

function AccessResults({ result }: { result: AccessCheckResult }) {
  const { token, orgs, checks, enterpriseSlug, representativeOrg, representativeTeam, checkedAt } = result;
  const tokenTypeLabel =
    token.type === "fine-grained" ? "Fine-grained" : token.type === "classic" ? "Classic" : "Unknown";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Access check</h2>
        <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(checkedAt).toLocaleString()}</span>
      </div>

      {/* Token identity + scopes */}
      <div className="mb-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
        <div className="flex flex-wrap items-center gap-2">
          {token.valid ? (
            <span className="inline-flex items-center gap-1 font-medium text-green-700 dark:text-green-300">
              <CheckCircle className="h-4 w-4" /> Token valid
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300">
              <XCircle className="h-4 w-4" /> Token invalid
            </span>
          )}
          {token.login && (
            <span className="text-gray-600 dark:text-gray-400">
              as <strong className="text-gray-800 dark:text-gray-200">{token.login}</strong>
              {token.name ? ` (${token.name})` : ""}
            </span>
          )}
          <span className="rounded-full bg-gray-200 px-2 py-0.5 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
            {tokenTypeLabel} token
          </span>
        </div>
        <div className="mt-2">
          {token.type === "fine-grained" ? (
            <span className="text-gray-500 dark:text-gray-400">
              Fine-grained tokens use per-resource permissions, not scopes — verify access via the checks below.
            </span>
          ) : token.scopes.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-gray-500 dark:text-gray-400">Scopes:</span>
              {token.scopes.map((s) => (
                <code key={s} className="rounded-sm bg-gray-200 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">
                  {s}
                </code>
              ))}
            </div>
          ) : (
            <span className="text-gray-500 dark:text-gray-400">No scopes reported for this token.</span>
          )}
        </div>
      </div>

      {/* Validation context */}
      {(representativeOrg || representativeTeam) && (
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          {representativeOrg && (
            <>
              Organization checks validated against{" "}
              <strong className="text-gray-700 dark:text-gray-300">{representativeOrg}</strong>.{" "}
            </>
          )}
          {representativeTeam && (
            <>
              Team-member check validated against{" "}
              <strong className="text-gray-700 dark:text-gray-300">{representativeTeam}</strong>.
            </>
          )}
        </p>
      )}

      {/* Per-endpoint access, grouped by scope of the resource */}
      <div className="space-y-4">
        <CheckTable title="Enterprise" rows={checks.filter((c) => c.group === "enterprise")} />
        <CheckTable title="Organization" rows={checks.filter((c) => c.group === "organization")} />
        <CheckTable title="Discovery & display names" rows={checks.filter((c) => c.group === "discovery")} />
      </div>

      {/* Organizations */}
      {orgs.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300">
            Organizations accessible ({orgs.length})
          </p>
          <div className="flex flex-wrap gap-1">
            {orgs.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-300"
              >
                <Building2 className="h-3 w-3" />
                {o.login}
              </span>
            ))}
          </div>
        </div>
      )}
      {!enterpriseSlug && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          No enterprise slug configured — enterprise checks were skipped.
        </p>
      )}
    </div>
  );
}

function CheckTable({ title, rows }: { title: string; rows: AccessCheckItem[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-gray-700 dark:text-gray-300">{title}</p>
      <div className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Access</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Capability</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Endpoint</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Required scope</th>
              <th className="px-3 py-2 text-left font-medium text-gray-600 dark:text-gray-400">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2">{statusIcon(c.status)}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-300">{c.label}</td>
                <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{c.endpoint}</td>
                <td className="px-3 py-2">
                  <code className="rounded-sm bg-gray-100 px-1 text-gray-700 dark:bg-gray-700 dark:text-gray-300">{c.requiredScope}</code>
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
