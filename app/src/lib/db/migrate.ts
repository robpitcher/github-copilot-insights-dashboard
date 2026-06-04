/**
 * Reusable database migration runner.
 *
 * Runs the Drizzle migrator (applies any pending migration files) followed by a
 * schema reconciliation pass. The reconciliation is derived directly from
 * `schema.ts` (see `schema-introspect.ts`): any column declared in the schema
 * but missing from the database is added with `ADD COLUMN IF NOT EXISTS`. This
 * is what makes the system self-healing against the historical "schema synced
 * via drizzle-kit push, deployed DB only ran migrations" drift that repeatedly
 * caused `column ... does not exist` ingestion failures.
 *
 * This module is shared by:
 *  - instrumentation.ts (runs automatically on app startup)
 *  - GET  /api/admin/migrate (status: list migrations + detect drift)
 *  - POST /api/admin/migrate (on-demand sync, admin-gated, from the Settings page)
 */

import { readFile } from "fs/promises";
import path from "path";
import { sql as dsql } from "drizzle-orm";
import { db } from "@/lib/db";
import { buildMigrationEntries, computeMigrationHash } from "@/lib/db/migration-status";
import { getSchemaColumns, getSchemaTables } from "@/lib/db/schema-introspect";

export interface MigrationResult {
  success: boolean;
  /** Human-readable log lines describing what happened. */
  logs: string[];
  /** Set when the Drizzle migrator step failed. */
  migrationError?: string;
  /** Set when the schema reconciliation step failed. */
  fixupError?: string;
}

/** A single migration file and whether it has been applied to the DB. */
export interface MigrationEntry {
  idx: number;
  tag: string;
  /** Journal timestamp (epoch ms). */
  when: number;
  status: "applied" | "pending";
  reason?: string;
  expectedHash?: string;
  recordedHash?: string;
}

/** A column that schema.ts expects but may be missing on a drifted database. */
export interface ExpectedColumn {
  table: string;
  column: string;
}

export interface SchemaDrift {
  /** Total number of schema columns verified. */
  expectedCount: number;
  /** Columns expected by the schema but missing from the database. */
  missing: ExpectedColumn[];
  /** Tables expected by the schema but missing from the database. */
  missingTables: string[];
  hasDrift: boolean;
}

export interface MigrationStatus {
  migrations: MigrationEntry[];
  appliedCount: number;
  pendingCount: number;
  latestTag: string | null;
  drift: SchemaDrift;
}

/** Read the set of "table.column" pairs that currently exist in the database. */
async function getExistingColumns(
  exec: (q: string) => Promise<Array<{ table_name: string; column_name: string }>>,
): Promise<Set<string>> {
  const rows = await exec(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  return new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
}

/**
 * Reconcile the database against schema.ts by adding any missing columns.
 * Only touches columns of tables that already exist (missing tables are the
 * migrator's responsibility). Idempotent and safe on populated databases.
 */
async function reconcileSchema(
  sql: import("postgres").Sql,
  log: (message: string) => void,
): Promise<void> {
  const existing = await getExistingColumns(
    (q) => sql.unsafe(q) as unknown as Promise<Array<{ table_name: string; column_name: string }>>,
  );
  const existingTables = new Set([...existing].map((s) => s.split(".")[0]));

  let added = 0;
  for (const { table, column, ddl } of getSchemaColumns()) {
    if (!existingTables.has(table)) continue; // table missing → migrator handles it
    if (existing.has(`${table}.${column}`)) continue; // already present
    await sql.unsafe(ddl);
    log(`Schema reconcile: added missing column ${table}.${column}`);
    added++;
  }

  if (added === 0) {
    log("Schema reconcile: no missing columns — database matches schema");
  } else {
    log(`Schema reconcile: added ${added} missing column(s)`);
  }
}

/**
 * If the Drizzle migration registry says everything is applied but the public
 * schema is empty of every table this app expects, clear the registry so the
 * migrator runs all migrations from scratch. Returns true when the registry
 * was reset. No-ops when the registry is empty, the registry is missing, or
 * any expected table is still present.
 */
async function maybeResetDrizzleRegistry(
  sql: import("postgres").Sql,
  log: (message: string) => void,
): Promise<boolean> {
  // Registry exists?
  const reg = (await sql.unsafe(
    `SELECT to_regclass('drizzle.__drizzle_migrations') AS r`,
  )) as unknown as Array<{ r: string | null }>;
  if (!reg[0]?.r) return false;

  // Any applied migrations recorded?
  const counted = (await sql.unsafe(
    `SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations`,
  )) as unknown as Array<{ c: number }>;
  const applied = counted[0]?.c ?? 0;
  if (applied === 0) return false;

  // Any expected tables actually present?
  const expectedTables = getSchemaTables();
  if (expectedTables.length === 0) return false;
  const rows = (await sql.unsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  )) as unknown as Array<{ table_name: string }>;
  const present = new Set(rows.map((r) => r.table_name));
  const stillPresent = expectedTables.filter((t) => present.has(t));
  if (stillPresent.length > 0) return false;

  log(
    `Detected wiped public schema with ${applied} applied migration(s) recorded — clearing drizzle registry`,
  );
  await sql.unsafe(`TRUNCATE TABLE drizzle.__drizzle_migrations`);
  return true;
}

/**
 * Build a verbose, log-friendly description of a Postgres/Drizzle error. The
 * postgres-js driver wraps the underlying server error in `.cause`; without
 * walking the chain we only see the Drizzle wrapper's "Failed query: ..."
 * message and lose the actual reason (code, detail, hint, severity).
 */
function describePgError(err: unknown): string {
  const parts: string[] = [];
  let current: unknown = err;
  let depth = 0;
  while (current && depth < 5) {
    const e = current as {
      message?: string;
      code?: string;
      severity?: string;
      detail?: string;
      hint?: string;
      where?: string;
      cause?: unknown;
    };
    const piece: string[] = [];
    if (e.severity) piece.push(`[${e.severity}]`);
    if (e.code) piece.push(`code=${e.code}`);
    if (e.message) piece.push(e.message.split("\n")[0]);
    if (e.detail) piece.push(`detail=${e.detail}`);
    if (e.hint) piece.push(`hint=${e.hint}`);
    if (piece.length) parts.push(piece.join(" "));
    current = e.cause;
    depth++;
  }
  return parts.length ? parts.join(" | cause: ") : String(err);
}

/**
 * Run pending migrations plus idempotent schema fixups against the database
 * pointed to by DATABASE_URL. Never throws — failures are captured in the
 * returned result so callers (startup + API) can log or surface them.
 */
export async function runMigrations(): Promise<MigrationResult> {
  const logs: string[] = [];
  const log = (message: string) => {
    logs.push(message);
  };

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log("DATABASE_URL not set — skipping database migrations");
    return { success: false, logs, migrationError: "DATABASE_URL not set" };
  }

  const { drizzle } = await import("drizzle-orm/postgres-js");
  const { migrate } = await import("drizzle-orm/postgres-js/migrator");
  const postgres = (await import("postgres")).default;

  const sql = postgres(connectionString, { max: 1 });
  const migrationDb = drizzle({ client: sql });

  let migrationError: string | undefined;
  let fixupError: string | undefined;

  try {
    // Serialize migrations across concurrent app instances (Container Apps may
    // run >1 replica). A session-level advisory lock blocks other instances
    // until this one finishes; the key is an arbitrary fixed constant.
    await sql`SELECT pg_advisory_lock(427914)`;
    try {
      // Ensure the `public` schema exists and the session's search_path
      // resolves to it. Without this, migrations using unqualified identifiers
      // fail with `3F000 no schema has been selected to create in` when an
      // operator has done `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
      // (the new public schema is empty and the role's default search_path
      // doesn't resolve to any existing schema).
      try {
        await sql`CREATE SCHEMA IF NOT EXISTS public`;
        await sql.unsafe(`SET search_path TO public`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`search_path setup failed (continuing): ${msg}`);
      }

      // Detect catastrophic drift: the Drizzle registry claims migrations are
      // applied, but every schema-defined table is missing from `public`. This
      // happens when an operator wipes tables (e.g. `DROP SCHEMA public CASCADE`
      // or deleting tables individually) without clearing the `drizzle` schema.
      // Drizzle would then no-op and the app would fail on every query. Clear
      // the migrations registry so the migrator replays everything from scratch.
      // Safe because all migration DDL uses `IF NOT EXISTS` (enforced by
      // migrations.test.ts) and the public schema is empty.
      try {
        const cleared = await maybeResetDrizzleRegistry(sql, log);
        if (cleared) {
          log(
            "Database tables were wiped while the migration registry was intact — cleared registry to force a full replay",
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`Drift pre-check failed (continuing): ${msg}`);
      }

      try {
        await migrate(migrationDb, { migrationsFolder: "./drizzle" });
        log("Database migrations completed successfully");
      } catch (err) {
        // Dump the full error (with cause chain) to the container console so
        // the underlying Postgres reason isn't lost behind the Drizzle wrapper.
        console.error("Drizzle migrate() failed:", err);
        migrationError = describePgError(err);
        log(`Database migration failed: ${migrationError}`);
      }

      try {
        await reconcileSchema(sql, log);
      } catch (err) {
        fixupError = err instanceof Error ? err.message : String(err);
        log(`Schema reconcile failed: ${fixupError}`);
      }
    } finally {
      await sql`SELECT pg_advisory_unlock(427914)`;
    }
  } finally {
    await sql.end();
  }

  return {
    success: !migrationError && !fixupError,
    logs,
    migrationError,
    fixupError,
  };
}

/**
 * Inspect the database for drift: which schema-declared columns are missing.
 * Reads from the pooled connection; safe to call while the app is serving.
 * Only checks columns of tables that exist (a missing table is a migration
 * concern, not column drift).
 */
export async function checkSchemaDrift(): Promise<SchemaDrift> {
  const expected = getSchemaColumns();
  const expectedTables = getSchemaTables();
  let present = new Set<string>();
  let existingTables = new Set<string>();
  try {
    const rows = (await db.execute(
      dsql`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`,
    )) as unknown as Array<{ table_name: string; column_name: string }>;
    present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
    existingTables = new Set(rows.map((r) => r.table_name));
  } catch (err) {
    console.error("Schema drift check failed:", err);
  }

  const missing = expected
    .filter((c) => existingTables.has(c.table) && !present.has(`${c.table}.${c.column}`))
    .map((c) => ({ table: c.table, column: c.column }));

  const missingTables = expectedTables.filter((t) => !existingTables.has(t));

  return {
    expectedCount: expected.length,
    missing,
    missingTables,
    hasDrift: missing.length > 0 || missingTables.length > 0,
  };
}

/**
 * List every migration in the journal alongside whether it has been applied to
 * the connected database, plus a schema-drift summary. Used by the Migrations
 * settings page. Never throws — missing journal/table is treated as "nothing
 * applied yet" so the UI can still render.
 */
export async function listMigrationStatus(): Promise<MigrationStatus> {
  const journalPath = path.join(process.cwd(), "drizzle", "meta", "_journal.json");
  let entries: Array<{ idx: number; when: number; tag: string }> = [];
  try {
    const raw = await readFile(journalPath, "utf8");
    const journal = JSON.parse(raw) as { entries?: typeof entries };
    entries = journal.entries ?? [];
  } catch (err) {
    console.error("Failed to read migration journal:", err);
  }

  const appliedByWhen = new Map<number, string>();
  try {
    const rows = (await db.execute(
      dsql`SELECT created_at, hash FROM drizzle.__drizzle_migrations ORDER BY created_at`,
    )) as unknown as Array<{ created_at: string | number; hash: string }>;
    rows.forEach((row) => {
      const createdAt = Number(row.created_at);
      if (!Number.isNaN(createdAt) && row.hash) {
        appliedByWhen.set(createdAt, row.hash);
      }
    });
  } catch {
    // drizzle.__drizzle_migrations doesn't exist yet => nothing applied
  }

  const entriesWithHashes = await Promise.all(
    [...entries]
      .sort((a, b) => a.idx - b.idx)
      .map(async (entry) => {
        const migrationPath = path.join(process.cwd(), "drizzle", `${entry.tag}.sql`);
        const sqlText = await readFile(migrationPath, "utf8");
        return {
          idx: entry.idx,
          tag: entry.tag,
          when: entry.when,
          hash: computeMigrationHash(sqlText),
        };
      }),
  );

  const migrations = buildMigrationEntries(entriesWithHashes, appliedByWhen).map((entry) => ({
    idx: entry.idx,
    tag: entry.tag,
    when: entry.when,
    status: entry.status,
    reason: entry.reason,
    expectedHash: entry.expectedHash,
    recordedHash: entry.recordedHash,
  }));

  const appliedCount = migrations.filter((m) => m.status === "applied").length;
  const drift = await checkSchemaDrift();

  return {
    migrations,
    appliedCount,
    pendingCount: migrations.length - appliedCount,
    latestTag: entries.length ? entries[entries.length - 1].tag : null,
    drift,
  };
}
