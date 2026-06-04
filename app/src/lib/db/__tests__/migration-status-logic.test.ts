import { describe, expect, it } from "vitest";
import { buildMigrationEntries } from "../migration-status";

describe("buildMigrationEntries", () => {
  it("marks a migration as applied when the recorded hash matches the file hash", () => {
    const entries = [
      { idx: 0, tag: "20260601000000_alpha", when: 1, hash: "abc" },
      { idx: 1, tag: "20260601000001_beta", when: 2, hash: "def" },
    ];

    const appliedByWhen = new Map([[1, "abc"]]);

    expect(buildMigrationEntries(entries, appliedByWhen)).toEqual([
      {
        idx: 0,
        tag: "20260601000000_alpha",
        when: 1,
        hash: "abc",
        status: "applied",
        reason: "Recorded hash matches the migration file on disk",
        expectedHash: "abc",
        recordedHash: "abc",
      },
      {
        idx: 1,
        tag: "20260601000001_beta",
        when: 2,
        hash: "def",
        status: "pending",
        reason: "Not found in drizzle.__drizzle_migrations",
        expectedHash: "def",
        recordedHash: undefined,
      },
    ]);
  });

  it("reports a clear hash-mismatch reason when the recorded migration hash differs", () => {
    const entries = [{ idx: 0, tag: "20260601000000_alpha", when: 1, hash: "abc" }];

    const appliedByWhen = new Map([[1, "xyz"]]);

    expect(buildMigrationEntries(entries, appliedByWhen)[0]).toMatchObject({
      status: "pending",
      reason: "Hash mismatch: recorded migration hash differs from the migration file on disk",
      expectedHash: "abc",
      recordedHash: "xyz",
    });
  });
});
