import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import path from "path";

/**
 * Idempotency lint for migration SQL.
 *
 * Every migration must be safe to run against a database that was previously
 * synced via `drizzle-kit push` (which may already contain some objects). A
 * plain `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX` aborts the whole
 * migrator on such databases, which historically left the schema half-applied
 * and caused `column ... does not exist` ingestion failures. Requiring
 * `IF NOT EXISTS` makes every migration re-runnable and self-healing.
 */
describe("migration SQL idempotency", () => {
  const drizzleDir = path.resolve(__dirname, "../../../../drizzle");
  const files = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));

  it("finds migration files to lint", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  // Match DDL that creates objects without an IF NOT EXISTS guard.
  const offenders: Array<RegExp> = [
    /\bADD COLUMN\s+"/i, // expects ADD COLUMN IF NOT EXISTS "
    /\bCREATE TABLE\s+"/i, // expects CREATE TABLE IF NOT EXISTS "
    /\bCREATE INDEX\s+"/i, // expects CREATE INDEX IF NOT EXISTS "
    /\bCREATE UNIQUE INDEX\s+"/i, // expects CREATE UNIQUE INDEX IF NOT EXISTS "
  ];

  for (const file of files) {
    it(`${file} uses IF NOT EXISTS for all created objects`, () => {
      const sql = readFileSync(path.join(drizzleDir, file), "utf8");
      const violations: string[] = [];
      for (const pattern of offenders) {
        const match = sql.match(pattern);
        if (match) violations.push(match[0].trim());
      }
      expect(
        violations,
        `${file} has non-idempotent DDL (add IF NOT EXISTS): ${violations.join(", ")}`,
      ).toEqual([]);
    });
  }
});
