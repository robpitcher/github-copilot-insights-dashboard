import { describe, it, expect } from "vitest";
import {
  getSchemaColumns,
  getSchemaTables,
  isSafeIdentifier,
} from "@/lib/db/schema-introspect";

/**
 * Guards the schema-derived reconciliation engine (lib/db/migrate.ts) that
 * auto-adds any column declared in schema.ts but missing from the database.
 */
describe("schema introspection", () => {
  it("derives tables from schema.ts", () => {
    const tables = getSchemaTables();
    expect(tables.length).toBeGreaterThan(0);
    // Spot-check a few core star-schema tables.
    expect(tables).toContain("fact_copilot_usage_daily");
    expect(tables).toContain("dim_user");
  });

  it("derives every column with a safe, idempotent ADD COLUMN statement", () => {
    const columns = getSchemaColumns();
    expect(columns.length).toBeGreaterThan(0);
    for (const { table, column, ddl } of columns) {
      expect(isSafeIdentifier(table)).toBe(true);
      expect(isSafeIdentifier(column)).toBe(true);
      expect(ddl).toContain("ADD COLUMN IF NOT EXISTS");
      expect(ddl).toContain(`"${table}"`);
      expect(ddl).toContain(`"${column}"`);
    }
  });

  it("includes the historically drift-prone ai_adoption_phase column", () => {
    const columns = getSchemaColumns();
    const phase = columns.find(
      (c) => c.table === "fact_copilot_usage_daily" && c.column === "ai_adoption_phase",
    );
    expect(phase).toBeDefined();
    expect(phase!.ddl).toContain("smallint");
  });

  it("renders NOT NULL only when a default is present (safe on populated tables)", () => {
    const columns = getSchemaColumns();
    for (const { ddl } of columns) {
      if (ddl.includes("NOT NULL")) {
        expect(ddl).toContain("DEFAULT");
      }
    }
  });

  it("rejects unsafe identifiers", () => {
    expect(isSafeIdentifier("fact_copilot_usage_daily")).toBe(true);
    expect(isSafeIdentifier("DROP TABLE")).toBe(false);
    expect(isSafeIdentifier('foo";--')).toBe(false);
    expect(isSafeIdentifier("Mixed_Case")).toBe(false);
  });
});
