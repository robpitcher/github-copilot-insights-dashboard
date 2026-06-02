import { describe, it, expect } from "vitest";
import { flattenAggregateReport, buildUserTeamMap } from "../copilot-api";
import type { AggregateReportLine, UserTeamRecord } from "@/types/copilot-api";

describe("flattenAggregateReport", () => {
  it("expands day_totals into one record per day and tags the scope", () => {
    const lines: AggregateReportLine[] = [
      {
        enterprise_id: "1",
        report_start_day: "2025-09-04",
        report_end_day: "2025-10-01",
        day_totals: [
          { day: "2025-09-30", daily_active_users: 5 },
          { day: "2025-10-01", daily_active_users: 7, pull_requests: { total_created: 3 } },
        ],
      },
    ];

    const records = flattenAggregateReport(lines, "enterprise");

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ day: "2025-09-30", daily_active_users: 5, _scope: "enterprise" });
    expect(records[1]).toMatchObject({
      day: "2025-10-01",
      daily_active_users: 7,
      _scope: "enterprise",
    });
    expect(records[1].pull_requests?.total_created).toBe(3);
  });

  it("inherits enterprise_id from the wrapping line when missing on a day", () => {
    const lines: AggregateReportLine[] = [
      { enterprise_id: "42", day_totals: [{ day: "2025-10-01", daily_active_users: 1 }] },
    ];

    const [record] = flattenAggregateReport(lines, "enterprise");
    expect(record.enterprise_id).toBe("42");
  });

  it("passes through already-flat lines and applies org login", () => {
    const lines: AggregateReportLine[] = [
      { day: "2025-10-01", organization_id: "99" } as AggregateReportLine,
    ];

    const [record] = flattenAggregateReport(lines, "organization", "acme");
    expect(record).toMatchObject({ day: "2025-10-01", _scope: "organization", _orgLogin: "acme" });
  });

  it("ignores lines with neither day_totals nor a top-level day", () => {
    const lines: AggregateReportLine[] = [{ enterprise_id: "1" }];
    expect(flattenAggregateReport(lines, "enterprise")).toEqual([]);
  });
});

describe("buildUserTeamMap", () => {
  it("maps (user_id|day) to the lowest team_id when a user has multiple teams", () => {
    const rows: UserTeamRecord[] = [
      { user_id: 1, day: "2026-05-14", team_id: 43, slug: "backend" },
      { user_id: 1, day: "2026-05-14", team_id: 42, slug: "frontend" },
      { user_id: 2, day: "2026-05-14", team_id: 42, slug: "frontend" },
    ];

    const map = buildUserTeamMap(rows);

    expect(map.get("1|2026-05-14")).toBe(42);
    expect(map.get("2|2026-05-14")).toBe(42);
  });

  it("keys separately per day for the same user", () => {
    const rows: UserTeamRecord[] = [
      { user_id: 1, day: "2026-05-14", team_id: 10 },
      { user_id: 1, day: "2026-05-15", team_id: 20 },
    ];

    const map = buildUserTeamMap(rows);
    expect(map.get("1|2026-05-14")).toBe(10);
    expect(map.get("1|2026-05-15")).toBe(20);
  });

  it("skips rows without a team_id", () => {
    const rows = [{ user_id: 1, day: "2026-05-14" }] as unknown as UserTeamRecord[];
    expect(buildUserTeamMap(rows).size).toBe(0);
  });
});
