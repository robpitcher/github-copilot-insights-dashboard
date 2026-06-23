"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme/theme-provider";
import { useTranslation } from "@/lib/i18n/locale-provider";
import {
  Contact,
  Network,
  Code,
  BarChart3,
  BookOpen,
  CreditCard,
  Settings,
  Sparkles,
  Gem,
  Coins,
  GitPullRequest,
  Layers,
  LogOut,
  Sun,
  Moon,
  Monitor,
  Globe,
  UserCircle,
} from "lucide-react";
import { AgentIcon } from "@/components/icons/agent-icon";
import { CliIcon } from "@/components/icons/cli-icon";

/**
 * Navigation entries. Flags drive role-based gating in identity mode:
 *   - `identityOnly`: only shown when identity mode is enabled (e.g. "My Usage",
 *     which scopes to the signed-in developer's own rows).
 *   - `orgWide`: a cross-user / org-wide report hidden from developers; admins
 *     (and open / shared-password modes) keep the current behavior.
 * Server-side enforcement (issue C1) is the source of truth — this only hides
 * nav entries that a developer cannot meaningfully use.
 *
 * Reports are ordered from highest impact (top) to lowest. The deprecated
 * Premium Requests report sits at the bottom, followed by a separator and the
 * Metrics Reference.
 */
const NAV_KEYS = [
  { key: "aiAnalyst.nav", href: "/ai-analyst", icon: Sparkles, orgWide: true },
  { key: "nav.myUsage", href: "/my-usage", icon: UserCircle, identityOnly: true },
  { key: "nav.copilotUsage", href: "/metrics", icon: BarChart3, orgWide: true },
  { key: "nav.codeGeneration", href: "/code-generation", icon: Code, orgWide: true },
  { key: "nav.pullRequests", href: "/pull-requests", icon: GitPullRequest, orgWide: true },
  { key: "nav.agentImpact", href: "/agents", icon: AgentIcon, orgWide: true },
  { key: "nav.aiAdoption", href: "/ai-adoption", icon: Layers, orgWide: true },
  { key: "nav.cliImpact", href: "/cli", icon: CliIcon, orgWide: true },
  { key: "nav.copilotLicensing", href: "/seats", icon: CreditCard, orgWide: true },
  { key: "nav.aiCredits", href: "/ai-credits", icon: Coins, orgWide: true },
  { key: "nav.usersData", href: "/users", icon: Contact, orgWide: true },
  { key: "nav.enterpriseTeams", href: "/enterprise-teams", icon: Network, orgWide: true },
  { key: "nav.premiumRequests", href: "/premium-requests", icon: Gem, orgWide: true },
  { key: "nav.metricsReference", href: "/reference", icon: BookOpen, orgWide: true, separatorBefore: true },
];

interface SessionInfo {
  identityMode: boolean;
  authenticated: boolean;
  login: string | null;
  role: "admin" | "developer" | null;
}

const THEME_ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { t, locale, setLocale, locales, dir } = useTranslation();
  const navRef = useRef<HTMLUListElement>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => (r.ok ? (r.json() as Promise<SessionInfo>) : null))
      .then((data) => {
        if (data) setSession(data);
      })
      .catch(() => {
        // Fail open: keep current (non-gated) behavior if the check fails.
      })
      .finally(() => setSessionLoaded(true));
  }, []);

  // Gating only applies in identity mode. A developer sees "My Usage" and no
  // org-wide reports; admins (and open / shared-password modes) see everything.
  const isIdentityMode = session?.identityMode === true;
  const isDeveloper = isIdentityMode && session?.role === "developer";

  const navItems = NAV_KEYS.filter((item) => {
    if ("identityOnly" in item && item.identityOnly && !isIdentityMode) return false;
    if ("orgWide" in item && item.orgWide && isDeveloper) return false;
    return true;
  });

  // Stagger the navigation links into view on mount. They slide in from the
  // inline-start edge so the motion reads naturally in both LTR and RTL. Re-runs
  // when the gated nav list resolves so the real items animate (not the skeleton).
  useGSAP(
    () => {
      const root = navRef.current;
      if (!root) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(root.children, {
        opacity: 0,
        x: dir === "rtl" ? 12 : -12,
        duration: 0.4,
        ease: "power2.out",
        stagger: 0.04,
      });
    },
    { scope: navRef, dependencies: [dir, sessionLoaded] }
  );

  const cycleTheme = () => {
    const order: Array<"system" | "light" | "dark"> = ["system", "light", "dark"];
    const next = order[(order.indexOf(theme) + 1) % order.length];
    setTheme(next);
  };

  const ThemeIcon = THEME_ICONS[theme];

  return (
    <aside className="flex h-full w-60 flex-col border-e border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
      <Link href="/" className="flex h-14 items-center gap-2.5 border-b border-gray-200 px-4 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700">
        <Image src="/copilot-insights-icon.svg" alt="" width={24} height={24} />
        <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
          {t("common.copilotInsights")}
        </span>
      </Link>
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul ref={navRef} className="space-y-0.5">
          {sessionLoaded ? navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <li key={item.href}>
                {"separatorBefore" in item && item.separatorBefore && (
                  <hr className="my-2 border-gray-200 dark:border-gray-700" />
                )}
                <Link
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {t(item.key)}
                </Link>
              </li>
            );
          }) : Array.from({ length: 8 }).map((_, i) => (
            <li key={`nav-skeleton-${i}`} className="px-1 py-1.5">
              <div className="h-6 animate-pulse rounded-md bg-gray-100 dark:bg-gray-700" />
            </li>
          ))}
        </ul>
      </nav>
      <div className="border-t border-gray-200 px-2 py-3 dark:border-gray-700">
        {session?.login && (
          <div
            className="mb-1.5 flex items-center gap-2.5 px-3 py-1.5"
            title={`${t("common.signedInAs")}: ${session.login}`}
          >
            <UserCircle className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium uppercase leading-none tracking-wide text-gray-400 dark:text-gray-500">
                {t("common.signedInAs")}
              </p>
              <p className="mt-0.5 truncate text-sm font-medium text-gray-700 dark:text-gray-200">
                {session.login}
              </p>
            </div>
          </div>
        )}
        {sessionLoaded && !isDeveloper && (
          <Link
            href="/settings"
            className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <Settings className="h-4 w-4" />
            {t("common.settings")}
          </Link>
        )}
        <button
          type="button"
          onClick={() => {
            sessionStorage.removeItem("dashboard_authenticated");
            window.location.reload();
          }}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        >
          <LogOut className="h-4 w-4" />
          {t("common.signOut")}
        </button>
        {/* Theme + Language toggles */}
        <div className="mt-2 flex items-center gap-1 px-3">
          <button
            type="button"
            onClick={cycleTheme}
            title={`${t("theme.label")}: ${t(`theme.${theme}`)}`}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          >
            <ThemeIcon className="h-3.5 w-3.5" />
            <span>{t(`theme.${theme}`)}</span>
          </button>
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              onClick={(e) => {
                const menu = e.currentTarget.nextElementSibling;
                if (menu) menu.classList.toggle("hidden");
              }}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>{locale.toUpperCase()}</span>
            </button>
            <div className="absolute bottom-full start-0 z-50 mb-1 hidden min-w-[120px] rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-700">
              {locales.map((l) => (
                <button
                  key={l.code}
                  type="button"
                  onClick={(e) => {
                    setLocale(l.code);
                    const menu = e.currentTarget.parentElement;
                    if (menu) menu.classList.add("hidden");
                  }}
                  className={cn(
                    "block w-full px-3 py-1.5 text-start text-xs hover:bg-gray-50 dark:hover:bg-gray-600",
                    locale === l.code
                      ? "font-medium text-blue-700 dark:text-blue-400"
                      : "text-gray-700 dark:text-gray-300"
                  )}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-2 px-3 text-xs text-gray-400 dark:text-gray-500">
          v{process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0"}
          <span className="mx-1">·</span>
          {process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"}
          <span className="mx-1">·</span>
          {process.env.NEXT_PUBLIC_BUILD_TIME
            ? new Date(process.env.NEXT_PUBLIC_BUILD_TIME).toISOString().split("T")[0]
            : "local"}
        </div>
      </div>
    </aside>
  );
}
