import crypto from "node:crypto";

export type MigrationStatusVariant = "pending" | "drift" | "inSync";

export interface MigrationJournalEntry {
  idx: number;
  tag: string;
  when: number;
  hash: string;
}

export interface MigrationStatusEntry extends MigrationJournalEntry {
  status: "applied" | "pending";
  reason: string;
  expectedHash: string;
  recordedHash?: string;
}

export function getMigrationStatusVariant(
  hasPending: boolean,
  hasDrift: boolean,
): MigrationStatusVariant {
  if (hasPending) return "pending";
  if (hasDrift) return "drift";
  return "inSync";
}

export function computeMigrationHash(sqlText: string): string {
  return crypto.createHash("sha256").update(sqlText).digest("hex");
}

export function buildMigrationEntries(
  entries: MigrationJournalEntry[],
  appliedByWhen: Map<number, string>,
): MigrationStatusEntry[] {
  return entries.map((entry) => {
    const recordedHash = appliedByWhen.get(entry.when);
    const status = recordedHash === entry.hash ? "applied" : "pending";

    let reason = "Not found in drizzle.__drizzle_migrations";
    if (recordedHash) {
      reason =
        recordedHash === entry.hash
          ? "Recorded hash matches the migration file on disk"
          : "Hash mismatch: recorded migration hash differs from the migration file on disk";
    }

    return {
      ...entry,
      status,
      reason,
      expectedHash: entry.hash,
      recordedHash,
    };
  });
}
