export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { isValidDate, daysAgo } from "@/lib/utils";
import { getAiConfig } from "@/lib/db/ai-settings";
import { isInsightGenerationAborted, streamInsight } from "@/lib/ai/insights";

const bodySchema = z.object({
  kind: z.enum(["cost_license", "adoption", "executive", "delivery", "roi_forecast", "team_scorecards"]),
  start: z.string().refine(isValidDate).optional(),
  end: z.string().refine(isValidDate).optional(),
  orgId: z.coerce.number().int().optional(),
  force: z.boolean().optional(),
  locale: z.enum(["en", "ar", "es", "fr"]).optional(),
});

const jsonError = (error: string, status: number) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Server-Sent Events stream for AI insights. Emits `{ type: "reasoning" | "message", text }`
 * deltas as the model produces them, then a final `{ type: "done", content, cached }`.
 * A cache hit resolves immediately with the stored content and no deltas.
 */
export async function POST(request: NextRequest) {
  const { enabled, token } = await getAiConfig();
  if (!enabled) return jsonError("feature-disabled", 403);
  if (!token) return jsonError("not-configured", 409);

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch {
    return jsonError("Invalid input", 400);
  }

  const end = body.end ?? new Date().toISOString().split("T")[0];
  const start = body.start ?? daysAgo(28);

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), { once: true });
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          /* controller already closed (client disconnected) */
        }
      };
      try {
        const result = await streamInsight(
          body.kind,
          { start, end, orgId: body.orgId },
          { force: body.force, locale: body.locale, signal: abortController.signal },
          {
            onMessage: (text) => send({ type: "message", text }),
            onReasoning: (text) => send({ type: "reasoning", text }),
          },
        );
        send({ type: "done", content: result.content, cached: result.cached });
      } catch (error) {
        if (isInsightGenerationAborted(error)) return;
        console.error("AI insights stream failed:", error);
        send({ type: "error" });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
