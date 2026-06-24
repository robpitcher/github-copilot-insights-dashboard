"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import {
  BarChart3,
  BookOpen,
  CreditCard,
  GitPullRequest,
  Layers,
  Gem,
  Coins,
  Contact,
  Network,
  ArrowRight,
  Code,
  Sparkles,
  UserCircle,
} from "lucide-react";
import { AgentIcon } from "@/components/icons/agent-icon";
import { CliIcon } from "@/components/icons/cli-icon";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { ConfigurationBanner } from "@/components/layout/configuration-banner";
import { Reveal } from "@/components/ui/reveal";

interface SessionInfo {
  identityMode: boolean;
  authenticated: boolean;
  login: string | null;
  role: "admin" | "developer" | null;
}

export default function LandingPage() {
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? (r.json() as Promise<SessionInfo>) : null))
      .then((data) => {
        if (data) setSession(data);
      })
      .catch(() => {
        // Fail open: keep current (non-gated) behavior if the check fails. The
        // API middleware remains the source of truth for data access.
      })
      .finally(() => setSessionLoaded(true));
  }, []);

  // Gating only applies in identity mode, mirroring the sidebar. A developer
  // sees only their own scoped surface ("My Usage"); org-wide cards are hidden.
  const isIdentityMode = session?.identityMode === true;
  const isDeveloper = isIdentityMode && session?.role === "developer";

  // `orgWide`: cross-user report, hidden from developers.
  // `identityOnly`: only shown in identity mode (e.g. "My Usage").
  const allSections = [
    {
      title: t("aiAnalyst.title"),
      description: t("aiAnalyst.subtitle"),
      href: "/ai-analyst",
      icon: Sparkles,
      color: "text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:text-violet-400",
      orgWide: true,
    },
    {
      title: t("nav.myUsage"),
      description: t("myUsage.subtitle"),
      href: "/my-usage",
      icon: UserCircle,
      color: "text-sky-600 bg-sky-50 dark:bg-sky-900/30 dark:text-sky-400",
      identityOnly: true,
    },
    {
      title: t("landing.copilotUsage"),
      description: t("landing.copilotUsageDesc"),
      href: "/metrics",
      icon: BarChart3,
      color: "text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400",
      orgWide: true,
    },
    {
      title: t("landing.codeGeneration"),
      description: t("landing.codeGenerationDesc"),
      href: "/code-generation",
      icon: Code,
      color: "text-slate-600 bg-slate-50 dark:bg-slate-900/30 dark:text-slate-400",
      orgWide: true,
    },
    {
      title: t("landing.pullRequests"),
      description: t("landing.pullRequestsDesc"),
      href: "/pull-requests",
      icon: GitPullRequest,
      color: "text-orange-600 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-400",
      orgWide: true,
    },
    {
      title: t("landing.agentImpact"),
      description: t("landing.agentImpactDesc"),
      href: "/agents",
      icon: AgentIcon,
      color: "text-purple-600 bg-purple-50 dark:bg-purple-900/30 dark:text-purple-400",
      orgWide: true,
    },
    {
      title: t("landing.aiAdoption"),
      description: t("landing.aiAdoptionDesc"),
      href: "/ai-adoption",
      icon: Layers,
      color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400",
      orgWide: true,
    },
    {
      title: t("landing.cliImpact"),
      description: t("landing.cliImpactDesc"),
      href: "/cli",
      icon: CliIcon,
      color: "text-teal-600 bg-teal-50 dark:bg-teal-900/30 dark:text-teal-400",
      orgWide: true,
    },
    {
      title: t("landing.copilotLicensing"),
      description: t("landing.copilotLicensingDesc"),
      href: "/seats",
      icon: CreditCard,
      color: "text-green-600 bg-green-50 dark:bg-green-900/30 dark:text-green-400",
      orgWide: true,
    },
    {
      title: t("landing.premiumRequests"),
      description: t("landing.premiumRequestsDesc"),
      href: "/premium-requests",
      icon: Gem,
      color: "text-amber-600 bg-amber-50 dark:bg-amber-900/30 dark:text-amber-400",
      orgWide: true,
    },
    {
      title: t("landing.aiCredits"),
      description: t("landing.aiCreditsDesc"),
      href: "/ai-credits",
      icon: Coins,
      color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-400",
      orgWide: true,
    },
    {
      title: t("landing.usersTitle"),
      description: t("landing.usersDesc"),
      href: "/users",
      icon: Contact,
      color: "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400",
      orgWide: true,
    },
    {
      title: t("nav.enterpriseTeams"),
      description: t("landing.enterpriseTeamsDesc"),
      href: "/enterprise-teams",
      icon: Network,
      color: "text-pink-600 bg-pink-50 dark:bg-pink-900/30 dark:text-pink-400",
      orgWide: true,
    },
    {
      title: t("nav.metricsReference"),
      description: t("landing.metricsReferenceDesc"),
      href: "/reference",
      icon: BookOpen,
      color: "text-gray-600 bg-gray-100 dark:bg-gray-700 dark:text-gray-300",
      orgWide: true,
    },
  ];

  const sections = allSections.filter((s) => {
    if ("identityOnly" in s && s.identityOnly && !isIdentityMode) return false;
    if ("orgWide" in s && s.orgWide && isDeveloper) return false;
    return true;
  });

  // Developers land on their own usage; everyone else on the org-wide overview.
  const heroHref = isDeveloper ? "/my-usage" : "/metrics";
  const heroLabel = isDeveloper
    ? t("landing.viewMyUsage")
    : t("landing.viewCopilotUsage");

  return (
    <div className="mx-auto max-w-5xl space-y-10 py-8">
      <ConfigurationBanner />
      {/* Hero */}
      <Reveal className="text-center">
        <div className="mb-4 flex justify-center">
          <Image
            src="/copilot-icon.svg"
            alt="GitHub Copilot"
            width={128}
            height={128}
            priority
          />
        </div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          {t("landing.title")}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base text-gray-600 dark:text-gray-400">
          {t("landing.subtitle")}
        </p>
        <Link
          href={heroHref}
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700"
        >
          {heroLabel}
          <ArrowRight className="h-4 w-4" />
        </Link>
      </Reveal>

      {/* Section Cards */}
      <Reveal stagger className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {sessionLoaded
          ? sections.map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className="group rounded-lg border border-gray-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                >
                  <div className="flex items-center gap-3">
                    <div className={`inline-flex shrink-0 rounded-lg p-2.5 ${s.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="min-w-0 text-sm font-semibold text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400">
                      {s.title}
                    </h2>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 leading-relaxed dark:text-gray-400">
                    {s.description}
                  </p>
                </Link>
              );
            })
          : Array.from({ length: 8 }).map((_, i) => (
              <div
                key={`card-skeleton-${i}`}
                className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-gray-100 dark:bg-gray-700" />
                  <div className="h-4 w-24 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                </div>
                <div className="mt-3 h-3 w-full animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
                <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded bg-gray-100 dark:bg-gray-700" />
              </div>
            ))}
      </Reveal>

      {/* Data source note */}
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-center text-sm text-blue-800 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
        <p className="font-medium">{t("landing.poweredBy")}</p>
        <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">
          Data is synced periodically from your GitHub enterprise. Configure the
          sync schedule and API token in{" "}
          <Link href="/settings" className="underline hover:text-blue-800 dark:hover:text-blue-300">
            Settings
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
