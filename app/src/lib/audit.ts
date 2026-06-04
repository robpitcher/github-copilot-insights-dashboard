import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";
import { lt } from "drizzle-orm";

export type AuditCategory =
  | "auth"
  | "settings"
  | "data_sync"
  | "admin"
  | "system";

interface AuditEntry {
  action: string;
  category: AuditCategory;
  actor?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
}

/**
 * Log an audit event to the database.
 * Fire-and-forget — errors are logged but never thrown to callers.
 */
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLog).values({
      action: entry.action,
      category: entry.category,
      actor: entry.actor ?? "system",
      details: entry.details ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (err) {
    console.error("Failed to write audit log:", err);
  }
}

/**
 * Extract client IP address from request headers.
 */
export function getClientIp(request: Request): string | undefined {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return request.headers.get("x-real-ip") ?? undefined;
}

/** Default audit-log retention window (days). Overridable via AUDIT_RETENTION_DAYS. */
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;

/** Resolve the configured retention window, falling back to the default. */
export function getAuditRetentionDays(): number {
  const raw = process.env.AUDIT_RETENTION_DAYS;
  if (!raw) return DEFAULT_AUDIT_RETENTION_DAYS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_AUDIT_RETENTION_DAYS;
}

/**
 * Delete audit-log entries older than the retention window so the table doesn't
 * grow unbounded. Returns the number of rows removed. Errors are swallowed and
 * logged — pruning must never break the caller.
 */
export async function pruneAuditLog(retentionDays = getAuditRetentionDays()): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await db
      .delete(auditLog)
      .where(lt(auditLog.createdAt, cutoff))
      .returning({ id: auditLog.id });
    const removed = result.length;
    if (removed > 0) {
      console.info(`Audit log pruned: removed ${removed} entries older than ${retentionDays} days`);
    }
    return removed;
  } catch (err) {
    console.error("Failed to prune audit log:", err);
    return 0;
  }
}
