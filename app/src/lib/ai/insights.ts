import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { SessionEvent } from "@github/copilot-sdk";
import { db } from "@/lib/db";
import { aiInsights } from "@/lib/db/schema";
import { getAiConfig } from "@/lib/db/ai-settings";
import { getCopilotClient } from "./copilot-client";
import { denyAllExceptCustomTools } from "./tools";
import { INSIGHT_AGENTS } from "./agents";
import { resolveMaxReasoningEffort } from "./models";
import { getMetricSnapshot, type MetricKind, type InsightWindow } from "./insight-data";

/** UI locale → language name the model should write the analysis in. */
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  ar: "Arabic",
  es: "Spanish",
  fr: "French",
};

/**
 * Max time to wait for a single model response. The SDK's `sendAndWait` defaults
 * to 60s, which the deep-reasoning analyst (xhigh effort + long executive
 * briefing) routinely exceeds — that surfaced as
 * "Timeout after 60000ms waiting for session.idle". Allow up to 5 minutes; the
 * streaming path keeps the connection busy with reasoning/message deltas, so the
 * request never sits idle while the model thinks.
 */
const SDK_RESPONSE_TIMEOUT_MS = 300_000;

export class InsightGenerationAborted extends Error {
  constructor() {
    super("AI insight generation aborted");
    this.name = "InsightGenerationAborted";
  }
}

export function isInsightGenerationAborted(error: unknown): boolean {
  return error instanceof InsightGenerationAborted;
}

export interface GeneratedInsight {
  content: string;
  cached: boolean;
  data: unknown;
}

/**
 * Optional streaming hooks. When provided, the model runs with token streaming
 * on and these fire as chunks arrive — `onMessage` for the answer, `onReasoning`
 * for the model's extended-thinking trace (only emitted by reasoning models).
 */
export interface InsightStreamHandlers {
  onMessage?: (text: string) => void;
  onReasoning?: (text: string) => void;
}

/**
 * Core generator. Returns a cached narrative when one exists (unless `force`),
 * otherwise runs the agent and persists the result. When `handlers` is passed,
 * the session streams deltas through them as the response is produced.
 */
async function runInsight(
  kind: MetricKind,
  w: InsightWindow,
  opts: { force?: boolean; locale?: string; signal?: AbortSignal },
  handlers?: InsightStreamHandlers,
): Promise<GeneratedInsight> {
  const locale = opts.locale ?? "en";
  if (opts.signal?.aborted) throw new InsightGenerationAborted();
  const snapshot = await getMetricSnapshot(kind, w);
  if (opts.signal?.aborted) throw new InsightGenerationAborted();
  // Language is part of the cache scope so each UI language is cached separately.
  const scopeKey = `${kind}:${w.start}:${w.end}:${w.orgId ?? "all"}:${locale}`;
  const contentHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");

  // A forced refresh skips the cache read and regenerates from scratch.
  if (!opts.force) {
    const cached = await db
      .select({ content: aiInsights.content })
      .from(aiInsights)
      .where(
        and(
          eq(aiInsights.kind, kind),
          eq(aiInsights.scopeKey, scopeKey),
          eq(aiInsights.contentHash, contentHash),
        ),
      )
      .limit(1);
    if (cached[0]) {
      return { content: cached[0].content, cached: true, data: snapshot };
    }
  }

  const { model } = await getAiConfig();
  const agent = INSIGHT_AGENTS[kind];
  const client = await getCopilotClient();
  // Run the chosen model at its deepest supported reasoning for richer analysis.
  const reasoningEffort = await resolveMaxReasoningEffort(model);
  const session = await client.createSession({
    ...(model !== "auto" ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    // Stream tokens (and the reasoning trace) only when the caller wants them.
    ...(handlers
      ? {
          streaming: true,
          reasoningSummary: "detailed" as const,
          onEvent: (event: SessionEvent) => {
            if (event.type === "assistant.message_delta") {
              handlers.onMessage?.(event.data.deltaContent);
            } else if (event.type === "assistant.reasoning_delta") {
              handlers.onReasoning?.(event.data.deltaContent);
            }
          },
        }
      : {}),
    customAgents: [agent],
    agent: agent.name,
    // Empty mode requires every session to declare its tools. Insights are
    // pre-fed grounding data and need none, so opt into an empty toolset.
    availableTools: [],
    onPermissionRequest: denyAllExceptCustomTools,
  });

  const signal = opts.signal;
  let abortHandler: (() => void) | null = null;
  const abortPromise = signal
    ? new Promise<never>((_resolve, reject) => {
        abortHandler = () => {
          void session.disconnect().catch(() => {});
          reject(new InsightGenerationAborted());
        };
        signal.addEventListener("abort", abortHandler, { once: true });
      })
    : null;
  try {
    if (signal?.aborted) throw new InsightGenerationAborted();
    const languageName = LANGUAGE_NAMES[locale] ?? "English";
    const prompt =
      `Produce your analysis from this data. Write the entire response — including every ` +
      `section heading — in ${languageName}.\n\nDATA (JSON):\n${JSON.stringify(snapshot)}`;
    const responsePromise = session.sendAndWait({ prompt }, SDK_RESPONSE_TIMEOUT_MS);
    const res = abortPromise
      ? await Promise.race([responsePromise, abortPromise])
      : await responsePromise;
    const content = res?.data.content ?? "";

    await db
      .insert(aiInsights)
      .values({
        kind,
        scopeKey,
        contentHash,
        model: model ?? "auto",
        language: locale,
        content,
        windowStart: w.start,
        windowEnd: w.end,
      })
      .onConflictDoUpdate({
        // A forced refresh reuses the same (kind, scope, hash) key, so overwrite
        // the stored narrative and bump the timestamp.
        target: [aiInsights.kind, aiInsights.scopeKey, aiInsights.contentHash],
        set: {
          content,
          model: model ?? "auto",
          language: locale,
          createdAt: new Date(),
        },
      });

    return { content, cached: false, data: snapshot };
  } finally {
    if (signal && abortHandler) {
      signal.removeEventListener("abort", abortHandler);
    }
    await session.disconnect();
  }
}

/**
 * Generate (or return a cached) narrative for a business-value insight kind.
 * Caches by (kind, scope, language, hash-of-grounding-data) so repeat views
 * don't spend another premium request when the underlying numbers are unchanged.
 */
export function generateInsight(
  kind: MetricKind,
  w: InsightWindow,
  opts: { force?: boolean; locale?: string; signal?: AbortSignal } = {},
): Promise<GeneratedInsight> {
  return runInsight(kind, w, opts);
}

/**
 * Same as {@link generateInsight} but streams the answer (and the reasoning
 * trace) through `handlers` as it is produced. A cache hit resolves immediately
 * without emitting any deltas.
 */
export function streamInsight(
  kind: MetricKind,
  w: InsightWindow,
  opts: { force?: boolean; locale?: string; signal?: AbortSignal },
  handlers: InsightStreamHandlers,
): Promise<GeneratedInsight> {
  return runInsight(kind, w, opts, handlers);
}
