import { describe, it, expect } from "vitest";
import {
  parseAiCreditCsv,
  splitWindows,
  firstOfMonthUtc,
  yesterdayUtc,
} from "../ai-credit-report";

describe("parseAiCreditCsv", () => {
  it("parses a date × model × username CSV into normalized rows", () => {
    const csv = [
      "date,username,model,sku,gross_quantity,discount_quantity,net_quantity,gross_amount,discount_amount,net_amount",
      "2026-06-01,Alice,gpt-4o,copilot,10,4,6,1.00,0.40,0.60",
      "2026-06-01,BOB,claude,copilot,5,0,5,0.50,0,0.50",
    ].join("\n");

    const rows = parseAiCreditCsv(csv);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toMatchObject({
      usageDate: "2026-06-01",
      userLogin: "alice",
      model: "gpt-4o",
      sku: "copilot",
      grossQuantity: 10,
      discountQuantity: 4,
      netQuantity: 6,
      grossAmount: 1,
      discountAmount: 0.4,
      netAmount: 0.6,
    });
    // user_login is lowercased for consistent row-level scoping.
    expect(rows[1].userLogin).toBe("bob");
  });

  it("lowercases usernames and tolerates quoted fields", () => {
    const csv = [
      "Date,User,Model,Quantity,Net Amount",
      '2026-06-02,"Carol, Jr.",gpt-4o,3,0.30',
    ].join("\n");
    const rows = parseAiCreditCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].userLogin).toBe("carol, jr.");
    // A generic "quantity" column maps to netQuantity, mirrored to grossQuantity.
    expect(rows[0].netQuantity).toBe(3);
    expect(rows[0].grossQuantity).toBe(3);
    expect(rows[0].netAmount).toBe(0.3);
  });

  it("maps alternate header aliases (snake/space/case-insensitive)", () => {
    const csv = [
      "usage_date,user_login,model,net_credits,amount",
      "2026-06-03,Dave,gpt-4o,7,0.70",
    ].join("\n");
    const rows = parseAiCreditCsv(csv);
    expect(rows[0]).toMatchObject({
      usageDate: "2026-06-03",
      userLogin: "dave",
      netQuantity: 7,
      netAmount: 0.7,
    });
  });

  it("returns an empty array for empty or header-only content", () => {
    expect(parseAiCreditCsv("")).toEqual([]);
    expect(parseAiCreditCsv("date,username,model")).toEqual([]);
  });
});

describe("splitWindows", () => {
  it("returns a single window for a within-month range", () => {
    expect(splitWindows("2026-06-01", "2026-06-18")).toEqual([
      { start: "2026-06-01", end: "2026-06-18" },
    ]);
  });

  it("splits a multi-month backfill on calendar-month boundaries", () => {
    const windows = splitWindows("2026-05-15", "2026-07-10");
    expect(windows).toEqual([
      { start: "2026-05-15", end: "2026-05-31" },
      { start: "2026-06-01", end: "2026-06-30" },
      { start: "2026-07-01", end: "2026-07-10" },
    ]);
  });

  it("caps any single window at 31 days", () => {
    const windows = splitWindows("2026-01-01", "2026-01-31");
    for (const w of windows) {
      const days =
        (new Date(`${w.end}T00:00:00Z`).getTime() -
          new Date(`${w.start}T00:00:00Z`).getTime()) /
          86_400_000 +
        1;
      expect(days).toBeLessThanOrEqual(31);
    }
  });

  it("returns no windows for an inverted range", () => {
    expect(splitWindows("2026-06-10", "2026-06-01")).toEqual([]);
  });
});

describe("UTC window defaults", () => {
  it("firstOfMonthUtc returns the first day of the month", () => {
    expect(firstOfMonthUtc(new Date("2026-06-19T16:35:00Z"))).toBe("2026-06-01");
  });

  it("yesterdayUtc returns the prior UTC day", () => {
    expect(yesterdayUtc(new Date("2026-06-19T16:35:00Z"))).toBe("2026-06-18");
  });
});
