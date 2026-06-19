import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { createIdentitySession } from "@/lib/auth";
import type { NormalizedAiCreditItem } from "@/lib/db/ai-credit-usage";

/**
 * Server-side row-level scoping tests for `/api/metrics/ai-credits`.
 *
 * The DB reader is mocked to mirror the real `userScope` filtering so we can
 * prove the route never returns another user's rows to a `developer`, while an
 * `admin` retains cross-user access.
 */

const SAMPLE_ITEMS: NormalizedAiCreditItem[] = [
  {
    usageDate: "2026-06-01",
    product: "Copilot",
    sku: "copilot",
    model: "gpt-4o",
    costCenter: null,
    orgName: "acme",
    userLogin: "alice",
    teamName: null,
    unitType: "ai-credits",
    pricePerUnit: 0.1,
    grossQuantity: 10,
    discountQuantity: 4,
    netQuantity: 6,
    grossAmount: 1,
    discountAmount: 0.4,
    netAmount: 0.6,
  },
  {
    usageDate: "2026-06-01",
    product: "Copilot",
    sku: "copilot",
    model: "claude",
    costCenter: null,
    orgName: "acme",
    userLogin: "bob",
    teamName: null,
    unitType: "ai-credits",
    pricePerUnit: 0.1,
    grossQuantity: 20,
    discountQuantity: 0,
    netQuantity: 20,
    grossAmount: 2,
    discountAmount: 0,
    netAmount: 2,
  },
];

const getAiCreditItemsByMonthFromDb = vi.fn();

vi.mock("@/lib/db/ai-credit-usage", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db/ai-credit-usage")>(
    "@/lib/db/ai-credit-usage",
  );
  return {
    ...actual,
    getAiCreditItemsByMonthFromDb: (...args: unknown[]) =>
      getAiCreditItemsByMonthFromDb(...args),
  };
});

vi.mock("@/lib/db/settings", () => ({
  getGitHubConfig: vi.fn(async () => ({ token: "t", enterpriseSlug: "acme-inc" })),
}));

vi.mock("@/lib/github/resolve-display-names", () => ({
  resolveUserNames: vi.fn(async () => ({
    name: (login: string) => login,
    label: (login: string) => login,
    map: new Map<string, string>(),
  })),
}));

// The org-wide consumption layer (upstream) is suppressed for forced developer
// scopes by the route's RLS guard; mock it so tests are deterministic and never
// touch a real DB connection.
vi.mock("@/lib/db/ai-credit-consumption", () => {
  const empty = () => ({
    available: false,
    totalCreditsUsed: 0,
    activeUsers: 0,
    perUser: [],
    perOrg: [],
    perTeam: [],
    options: { users: [], orgs: [], teams: [] },
  });
  return {
    getCreditConsumption: vi.fn(async () => empty()),
    emptyConsumption: vi.fn(() => empty()),
  };
});

let GET: typeof import("@/app/api/metrics/ai-credits/route").GET;

function buildRequest(query: string, identityToken?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (identityToken) headers.cookie = `identity_session=${identityToken}`;
  return new NextRequest(`https://example.test/api/metrics/ai-credits${query}`, {
    headers,
  });
}

describe("/api/metrics/ai-credits row-level scoping", () => {
  const original = { ...process.env };

  beforeEach(async () => {
    process.env.GITHUB_OAUTH_CLIENT_ID = "id";
    process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
    process.env.SESSION_SECRET = "test-session-secret";

    // Seats fetch — return not-ok so the pagination loop exits immediately.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 404 })),
    );

    // Mirror the real DB scope filter: when userScope is set, only that user's rows.
    getAiCreditItemsByMonthFromDb.mockImplementation(
      async (
        _slug: string,
        points: Array<{ year: number; month: number }>,
        userScope?: string | null,
      ) => {
        const map = new Map<string, NormalizedAiCreditItem[]>();
        const scope = userScope ? userScope.toLowerCase() : null;
        for (const p of points) {
          if (p.year === 2026 && p.month === 6) {
            const rows = scope
              ? SAMPLE_ITEMS.filter((i) => (i.userLogin ?? "") === scope)
              : SAMPLE_ITEMS;
            map.set(`${p.year}-06`, rows);
          }
        }
        return map;
      },
    );

    ({ GET } = await import("@/app/api/metrics/ai-credits/route"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    process.env = { ...original };
  });

  it("forces a developer to their own rows even with a crafted ?user=", async () => {
    const token = createIdentitySession({ login: "alice", id: 1, role: "developer" });
    const res = await GET(buildRequest("?year=2026&month=6&user=bob", token));
    expect(res.status).toBe(200);
    const body = await res.json();

    // DB read was scoped to the session login, ignoring ?user=bob.
    const [, , userScope] = getAiCreditItemsByMonthFromDb.mock.calls[0];
    expect(userScope).toBe("alice");

    const users = body.perUserBreakdown.map((u: { user: string }) => u.user);
    expect(users).toEqual(["alice"]);
    expect(users).not.toContain("bob");
    // A scoped developer gets no cross-user filter options — the org-wide
    // consumption layer (which feeds the user dropdown) is suppressed for
    // forced scopes, so it can never surface another user.
    expect(body.filters.options.users).toEqual([]);
  });

  it("scopes a developer with no ?user= to their own rows", async () => {
    const token = createIdentitySession({ login: "alice", id: 1, role: "developer" });
    const res = await GET(buildRequest("?year=2026&month=6", token));
    const body = await res.json();
    const [, , userScope] = getAiCreditItemsByMonthFromDb.mock.calls[0];
    expect(userScope).toBe("alice");
    expect(body.perUserBreakdown.map((u: { user: string }) => u.user)).toEqual(["alice"]);
  });

  it("lets an admin read every user's rows (cross-user access retained)", async () => {
    const token = createIdentitySession({ login: "boss", id: 9, role: "admin" });
    const res = await GET(buildRequest("?year=2026&month=6", token));
    expect(res.status).toBe(200);
    const body = await res.json();

    // Admin reads are not user-scoped at the DB layer.
    const [, , userScope] = getAiCreditItemsByMonthFromDb.mock.calls[0];
    expect(userScope).toBeNull();

    // Cross-user access retained: the admin sees every user's billing rows.
    const users = body.perUserBreakdown.map((u: { user: string }) => u.user);
    expect(users).toContain("alice");
    expect(users).toContain("bob");
  });
});
