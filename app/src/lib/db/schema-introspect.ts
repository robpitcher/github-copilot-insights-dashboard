/**
 * Schema introspection helpers.
 *
 * Derives the set of (table, column) pairs that `schema.ts` declares, and builds
 * safe, idempotent `ADD COLUMN IF NOT EXISTS` statements for them. This is the
 * backbone of automatic schema-drift reconciliation: instead of maintaining a
 * hand-written list of columns (which inevitably drifts and caused repeated
 * "column does not exist" ingestion failures), we read the column definitions
 * straight from the Drizzle schema at runtime.
 *
 * All identifiers come from our own static schema — never user input — and are
 * additionally validated with `isSafeIdentifier` before interpolation.
 */

import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable, type PgColumn } from "drizzle-orm/pg-core";
import * as schema from "@/lib/db/schema";

export interface SchemaColumn {
  table: string;
  column: string;
  /** Rendered DDL for `ADD COLUMN IF NOT EXISTS`. */
  ddl: string;
}

/** Only lowercase snake_case identifiers are allowed for interpolation. */
export function isSafeIdentifier(name: string): boolean {
  return /^[a-z_][a-z0-9_]*$/.test(name);
}

/** Render a column default as a SQL literal, or null if it can't be safely inlined. */
function renderDefault(col: PgColumn): string | null {
  if (!col.hasDefault) return null;
  const value = col.default;
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  // Functions / sql`` defaults can't be inlined safely — skip the default.
  return null;
}

/**
 * Build a safe `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statement for a column.
 *
 * Safety rules for running against populated tables:
 *  - NOT NULL + default  → include both (the default backfills existing rows).
 *  - NOT NULL, no default → add as NULLABLE (a hard NOT NULL would fail on rows).
 *  - nullable            → include default only if one is defined.
 */
function buildAddColumn(table: string, col: PgColumn): string | null {
  if (!isSafeIdentifier(table) || !isSafeIdentifier(col.name)) return null;
  const type = col.getSQLType();
  const def = renderDefault(col);
  let stmt = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${col.name}" ${type}`;
  if (def !== null) {
    stmt += ` DEFAULT ${def}`;
    if (col.notNull) stmt += " NOT NULL";
  }
  return stmt;
}

/** Every (table, column) declared in schema.ts, with its reconcile DDL. */
export function getSchemaColumns(): SchemaColumn[] {
  const out: SchemaColumn[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const table = getTableName(value as PgTable);
    if (!isSafeIdentifier(table)) continue;
    const columns = getTableColumns(value as PgTable);
    for (const col of Object.values(columns)) {
      const ddl = buildAddColumn(table, col);
      if (ddl) out.push({ table, column: col.name, ddl });
    }
  }
  return out;
}

/** Every table name declared in schema.ts. */
export function getSchemaTables(): string[] {
  const out: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, PgTable)) continue;
    const name = getTableName(value as PgTable);
    if (isSafeIdentifier(name)) out.push(name);
  }
  return out;
}
