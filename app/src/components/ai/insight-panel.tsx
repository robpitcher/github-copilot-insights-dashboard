"use client";

import { useCallback, useEffect, useRef, useState, type ComponentType } from "react";
import { RefreshCw, AlertCircle, Sparkles, FlaskConical, ChevronDown, Brain } from "lucide-react";
import { useTranslation } from "@/lib/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/ui/markdown";

export type InsightKind =
  | "cost_license"
  | "adoption"
  | "executive"
  | "delivery"
  | "roi_forecast"
  | "team_scorecards";

interface AiStatus {
  enabled: boolean;
  configured: boolean;
}

export interface AiInsightPanelProps {
  kind: InsightKind;
  title: string;
  /** Short summary shown in the collapsed card header. */
  description?: string;
  /** Topic icon shown in the gradient avatar. Defaults to Sparkles. */
  icon?: ComponentType<{ className?: string }>;
  /** Window start (YYYY-MM-DD). Omit to let the server default to the last 28 days. */
  start?: string;
  /** Window end (YYYY-MM-DD). */
  end?: string;
  /** Optional single org scope. */
  orgId?: number;
  /** When the parent already gated on AI status, skip the per-panel status fetch. */
  skipStatusCheck?: boolean;
  /** Start expanded (e.g. on the dedicated AI hub). Defaults to collapsed. */
  defaultOpen?: boolean;
  className?: string;
}

/**
 * A self-contained, collapsible AI insight card.
 *
 * Design goals:
 *  - Stands out from normal report cards (violet/blue gradient + Sparkles) so
 *    readers never mistake the narrative for source data.
 *  - Always advertises that the content is AI-generated and experimental.
 *  - Collapsed by default so the model is only called when the user expands it
 *    (each generation is a billed premium request). The dedicated AI hub passes
 *    `defaultOpen` since that page exists for AI.
 *
 * It checks whether the feature is enabled+configured (unless the parent already
 * did) and renders nothing when off, so it can be dropped onto any report page
 * without guarding the call site. Refresh forces a cache-bypassing run.
 */
export function AiInsightPanel({
  kind,
  title,
  description,
  icon: Icon = Sparkles,
  start,
  end,
  orgId,
  skipStatusCheck,
  defaultOpen = false,
  className,
}: AiInsightPanelProps) {
  const { t, locale } = useTranslation();
  const [available, setAvailable] = useState<boolean>(skipStatusCheck ?? false);
  const [checking, setChecking] = useState<boolean>(!skipStatusCheck);
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const [content, setContent] = useState<string | null>(null);
  const [reasoning, setReasoning] = useState("");
  const [showReasoning, setShowReasoning] = useState(true);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  // The window the panel last *attempted* to generate for. Guards the lazy
  // effect so it fires once per window and never loops on error.
  const attemptedKeyRef = useRef<string | null>(null);
  const activeRequestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const windowKey = `${kind}|${start ?? ""}|${end ?? ""}|${orgId ?? ""}|${locale}`;

  // Resolve feature availability unless the parent already gated on it.
  useEffect(() => {
    if (skipStatusCheck) {
      setAvailable(true);
      setChecking(false);
      return;
    }
    let active = true;
    fetch("/api/ai/status")
      .then((r) => r.json())
      .then((s: AiStatus) => {
        if (active) setAvailable(Boolean(s.enabled && s.configured));
      })
      .catch(() => {
        if (active) setAvailable(false);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [skipStatusCheck]);

  const load = useCallback(
    async (force: boolean) => {
      abortRef.current?.abort();
      const requestId = activeRequestRef.current + 1;
      activeRequestRef.current = requestId;
      const abortController = new AbortController();
      abortRef.current = abortController;
      const isCurrent = () =>
        activeRequestRef.current === requestId && !abortController.signal.aborted;

      attemptedKeyRef.current = windowKey;
      setLoading(true);
      setError(false);
      setContent(null);
      setReasoning("");
      setShowReasoning(true);
      try {
        const res = await fetch("/api/ai/insights/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind, start, end, orgId, force, locale }),
          signal: abortController.signal,
        });
        if (!isCurrent()) return;
        if (!res.ok || !res.body) {
          if (isCurrent()) setError(true);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";
        let think = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            if (!isCurrent()) return;
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let evt: {
              type: string;
              text?: string;
              content?: string;
              cached?: boolean;
            };
            try {
              evt = JSON.parse(dataLine.slice(5).trim());
            } catch {
              continue;
            }
            if (evt.type === "message" && evt.text) {
              answer += evt.text;
              if (isCurrent()) setContent(answer);
            } else if (evt.type === "reasoning" && evt.text) {
              think += evt.text;
              if (isCurrent()) setReasoning(think);
            } else if (evt.type === "done") {
              if (typeof evt.content === "string" && isCurrent()) setContent(evt.content);
              if (isCurrent()) setCached(Boolean(evt.cached));
              if (isCurrent()) setShowReasoning(false);
            } else if (evt.type === "error") {
              if (isCurrent()) setError(true);
            }
          }
        }
      } catch (err) {
        if (abortController.signal.aborted) return;
        if (isCurrent()) setError(true);
      } finally {
        if (isCurrent()) {
          setLoading(false);
          abortRef.current = null;
        }
      }
    },
    [kind, start, end, orgId, locale, windowKey],
  );

  // Lazy generation: only call the model once expanded, and only when the window
  // changed since the last attempt. Keeps premium requests opt-in and never loops.
  useEffect(() => {
    if (!available || !open) return;
    if (attemptedKeyRef.current === windowKey) return;
    load(false);
  }, [available, open, windowKey, load]);

  // Feature off / not configured / still checking → render nothing.
  if (checking || !available) return null;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-violet-200 bg-linear-to-br from-violet-50 to-blue-50 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-blue-950/20",
        className,
      )}
    >
      {/* Header — always visible; toggles the body */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? t("aiAnalyst.hideAnalysis") : t("aiAnalyst.showAnalysis")}
        className="group flex w-full items-start justify-between gap-4 px-5 py-4 text-start transition-colors hover:bg-white/40 dark:hover:bg-white/5"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-blue-500 text-white shadow-sm shadow-violet-500/20">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
              <h3 className="min-w-0 text-sm font-semibold text-gray-900 dark:text-gray-100">
                {title}
              </h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                  <Sparkles className="h-3 w-3" />
                  {t("aiAnalyst.aiGenerated")}
                </span>
                <span
                  title={t("aiAnalyst.experimentalTooltip")}
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                >
                  <FlaskConical className="h-3 w-3" />
                  {t("aiAnalyst.experimental")}
                </span>
              </div>
            </div>
            {description && (
              <p className="max-w-4xl text-balance text-xs leading-relaxed text-gray-600 dark:text-gray-400">
                {description}
              </p>
            )}
          </div>
        </div>
        <ChevronDown
          className={cn(
            "mt-3 h-4 w-4 shrink-0 text-gray-400 transition-transform group-hover:text-violet-500",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Body */}
      {open && (
        <div className="border-t border-violet-200/70 px-5 pb-4 pt-3 dark:border-violet-900/40">
          <div className="mb-2 flex items-center justify-end gap-2">
            {cached && !loading && (
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-gray-500 dark:bg-gray-800/70 dark:text-gray-400">
                {t("aiAnalyst.cached")}
              </span>
            )}
            <button
              type="button"
              onClick={() => load(true)}
              disabled={loading}
              title={t("aiAnalyst.regenerate")}
              className="rounded-md p-1 text-gray-400 hover:bg-white/70 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-gray-800/70 dark:hover:text-gray-300"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            </button>
          </div>

          {/* Reasoning / thinking trace (only emitted by reasoning-capable models) */}
          {reasoning && (
            <div className="mb-3 rounded-md border border-violet-200/60 bg-white/50 dark:border-violet-900/30 dark:bg-gray-900/30">
              <button
                type="button"
                onClick={() => setShowReasoning((v) => !v)}
                aria-expanded={showReasoning}
                className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-medium text-violet-700 dark:text-violet-300"
              >
                <Brain className={cn("h-3.5 w-3.5", loading && "animate-pulse")} />
                {loading ? t("aiAnalyst.thinking") : t("aiAnalyst.reasoning")}
                <ChevronDown
                  className={cn(
                    "ms-auto h-3.5 w-3.5 transition-transform",
                    showReasoning && "rotate-180",
                  )}
                />
              </button>
              {showReasoning && (
                <div className="max-h-40 overflow-y-auto px-3 pb-2">
                  <Markdown
                    theme="dashboard"
                    className="text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 [&_code]:text-[10px] [&_h1]:text-xs [&_h2]:text-[11px] [&_h3]:text-[11px] [&_pre]:text-[10px]"
                  >
                    {reasoning}
                  </Markdown>
                </div>
              )}
            </div>
          )}

          {error ? (
            <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4" />
              {t("aiAnalyst.error")}
            </p>
          ) : content ? (
            <>
              <div className="rounded-md bg-white/60 p-3 dark:bg-gray-900/40">
                <Markdown theme="github">{content}</Markdown>
              </div>
              <p className="mt-3 flex items-start gap-1.5 border-t border-violet-200/60 pt-2 text-[11px] text-gray-500 dark:border-violet-900/30 dark:text-gray-400">
                <FlaskConical className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                {t("aiAnalyst.disclaimer")}
              </p>
            </>
          ) : loading ? (
            <div className="space-y-2">
              <p className="text-xs text-violet-700/70 dark:text-violet-300/70">
                {t("aiAnalyst.generating")}
              </p>
              <div className="h-3 w-3/4 animate-pulse rounded bg-violet-100 dark:bg-violet-900/40" />
              <div className="h-3 w-full animate-pulse rounded bg-violet-100 dark:bg-violet-900/40" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-violet-100 dark:bg-violet-900/40" />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
