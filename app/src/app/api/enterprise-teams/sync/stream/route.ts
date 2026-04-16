import { NextRequest } from "next/server";
import { getGitHubConfig } from "@/lib/db/settings";
import { syncEnterpriseTeams } from "@/lib/etl/enterprise-teams";
import { safeErrorMessage } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Streams enterprise teams sync progress to the client as Server-Sent Events.
 * Same event format used by `/api/ingest/stream` so the Data Sync page can
 * reuse its existing SSE reader.
 */
export async function POST(request: NextRequest) {
  const { token, enterpriseSlug } = await getGitHubConfig();

  if (!token || !enterpriseSlug) {
    return new Response(
      JSON.stringify({
        error: "GitHub token and enterprise slug must be configured.",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (type: string, data: string) => {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type, message: data })}\n\n`,
            ),
          );
        } catch {
          // stream already closed (e.g. client disconnect)
        }
      };

      const abortHandler = () => {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      request.signal.addEventListener("abort", abortHandler);

      send("log", `[${new Date().toISOString()}] Enterprise teams sync started`);

      try {
        const result = await syncEnterpriseTeams({
          enterpriseSlug,
          token,
          source: "api",
          onLog: (msg) => send("log", `[${new Date().toISOString()}] ${msg}`),
        });

        send("done", JSON.stringify(result));
      } catch (err) {
        send("error", safeErrorMessage(err, "Enterprise teams sync failed"));
      } finally {
        request.signal.removeEventListener("abort", abortHandler);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
