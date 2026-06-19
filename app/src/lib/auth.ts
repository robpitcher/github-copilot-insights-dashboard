import { timingSafeEqual, createHmac } from "crypto";
import { NextResponse } from "next/server";

/* ── Constants ── */

const COOKIE_DASHBOARD = "dashboard_session";
const COOKIE_ADMIN = "admin_session";
const COOKIE_IDENTITY = "identity_session";
const TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const SIGNING_SALT = "copilot-insights-session-v1";

/* ── Rate Limiter ── */

interface RateEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateEntry>();

const RATE_LIMIT_MAX = 10; // max attempts
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  return entry.count <= RATE_LIMIT_MAX;
}

/* ── Failed-attempt Lockout ── */

interface LockoutEntry {
  failures: number;
  /** Epoch ms until which the key is locked out (0 = not locked). */
  lockedUntil: number;
  /** When the current failure window resets. */
  windowResetAt: number;
}

const lockoutStore = new Map<string, LockoutEntry>();

const LOCKOUT_THRESHOLD = 5; // consecutive failures before lockout
const LOCKOUT_WINDOW_MS = 15 * 60_000; // window over which failures accumulate
const LOCKOUT_DURATION_MS = 15 * 60_000; // how long the lockout lasts

/**
 * Returns the number of milliseconds remaining on an active lockout for `key`,
 * or 0 if the key is not currently locked out. Use before verifying a password.
 */
export function getLockoutRemainingMs(key: string): number {
  const entry = lockoutStore.get(key);
  if (!entry) return 0;
  const now = Date.now();
  if (entry.lockedUntil > now) return entry.lockedUntil - now;
  return 0;
}

/**
 * Record a failed authentication attempt for `key`. Once failures reach the
 * threshold within the window, the key is locked out for a fixed duration.
 * Returns true if this attempt triggered (or is within) a lockout.
 */
export function recordFailedAttempt(key: string): boolean {
  const now = Date.now();
  const entry = lockoutStore.get(key);

  if (!entry || now > entry.windowResetAt) {
    lockoutStore.set(key, {
      failures: 1,
      lockedUntil: 0,
      windowResetAt: now + LOCKOUT_WINDOW_MS,
    });
    return false;
  }

  entry.failures++;
  if (entry.failures >= LOCKOUT_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    entry.windowResetAt = now + LOCKOUT_DURATION_MS;
    return true;
  }
  return false;
}

/** Clear any recorded failures/lockout for `key` after a successful auth. */
export function clearFailedAttempts(key: string): void {
  lockoutStore.delete(key);
}

/* ── Timing-safe Password Comparison ── */

/** Constant-time string comparison to prevent timing attacks. */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  // Always compare equal-length buffers to prevent timing leaks
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.alloc(maxLen, 0);
  const paddedB = Buffer.alloc(maxLen, 0);
  bufA.copy(paddedA);
  bufB.copy(paddedB);

  const equal = timingSafeEqual(paddedA, paddedB);
  return equal && bufA.length === bufB.length;
}

/* ── Session Token (HMAC-signed, stateless) ── */

function getSigningKey(password: string): Buffer {
  return createHmac("sha256", SIGNING_SALT).update(password).digest();
}

export function createSessionToken(type: "dashboard" | "admin"): string {
  const password =
    type === "dashboard"
      ? process.env.DASHBOARD_PASSWORD
      : process.env.ADMIN_PASSWORD;

  if (!password) return "";

  const payload = `${type}:${Date.now()}`;
  const key = getSigningKey(password);
  const signature = createHmac("sha256", key).update(payload).digest("hex");

  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

function verifySessionToken(
  token: string,
  type: "dashboard" | "admin",
): boolean {
  const password =
    type === "dashboard"
      ? process.env.DASHBOARD_PASSWORD
      : process.env.ADMIN_PASSWORD;

  if (!password) return true; // No password configured = open access
  if (!token) return false;

  const dotIdx = token.indexOf(".");
  if (dotIdx < 0) return false;

  const payloadB64 = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  if (!payloadB64 || !signature) return false;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch {
    return false;
  }

  const colonIdx = payload.indexOf(":");
  if (colonIdx < 0) return false;

  const tokenType = payload.slice(0, colonIdx);
  const timestampStr = payload.slice(colonIdx + 1);

  if (tokenType !== type) return false;

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp) || Date.now() - timestamp > TOKEN_EXPIRY_MS) return false;

  const key = getSigningKey(password);
  const expectedSignature = createHmac("sha256", key)
    .update(payload)
    .digest("hex");

  try {
    return safeCompare(signature, expectedSignature);
  } catch {
    return false;
  }
}

/* ── Cookie Helpers ── */

function getCookieValue(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;
  // Use simple split approach — safe since cookie names/values don't contain `;` or `=`
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.floor(TOKEN_EXPIRY_MS / 1000),
  };
}

export const COOKIE_NAMES = {
  dashboard: COOKIE_DASHBOARD,
  admin: COOKIE_ADMIN,
  identity: COOKIE_IDENTITY,
} as const;

/* ── Identity Session (GitHub OAuth, HMAC-signed) ── */

export type Role = "admin" | "developer";

export interface IdentitySession {
  /** GitHub login (handle). */
  login: string;
  /** GitHub numeric user id. */
  id: number;
  /** Resolved role for this session. */
  role: Role;
}

/**
 * Identity mode is active only when the GitHub OAuth + session-signing env vars
 * are all set. When unset, open and shared-password modes are unaffected.
 */
export function isIdentityModeEnabled(): boolean {
  return (
    !!process.env.GITHUB_OAUTH_CLIENT_ID &&
    !!process.env.GITHUB_OAUTH_CLIENT_SECRET &&
    !!process.env.SESSION_SECRET
  );
}

/**
 * Resolve a signed-in user's role from the `ADMIN_LOGINS` allowlist.
 * Comparison is case-insensitive; anyone not listed defaults to `developer`.
 */
export function resolveRole(login: string): Role {
  const allow = (process.env.ADMIN_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allow.includes(login.trim().toLowerCase()) ? "admin" : "developer";
}

/**
 * Mint a signed identity session token carrying the user's login, id and role.
 * Signed with `SESSION_SECRET` using the same HMAC scheme as password sessions.
 * Returns "" when no signing secret is configured.
 */
export function createIdentitySession(session: IdentitySession): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return "";

  const payloadObj = {
    login: session.login,
    id: session.id,
    role: session.role,
    iat: Date.now(),
  };
  const payload = JSON.stringify(payloadObj);
  const key = getSigningKey(secret);
  const signature = createHmac("sha256", key).update(payload).digest("hex");

  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

/**
 * Verify an identity session token. Returns the decoded session when the
 * signature is valid and the token is not expired, otherwise null.
 */
export function verifyIdentitySession(token: string): IdentitySession | null {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token) return null;

  const dotIdx = token.indexOf(".");
  if (dotIdx < 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const signature = token.slice(dotIdx + 1);
  if (!payloadB64 || !signature) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString();
  } catch {
    return null;
  }

  const key = getSigningKey(secret);
  const expectedSignature = createHmac("sha256", key)
    .update(payload)
    .digest("hex");

  if (!safeCompare(signature, expectedSignature)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { login, id, role, iat } = parsed as Record<string, unknown>;

  if (
    typeof login !== "string" ||
    typeof id !== "number" ||
    (role !== "admin" && role !== "developer") ||
    typeof iat !== "number"
  ) {
    return null;
  }

  if (Date.now() - iat > TOKEN_EXPIRY_MS) return null;

  return { login, id, role };
}

/**
 * Extract and verify the identity session carried on a request's
 * `identity_session` cookie. Returns null when identity mode is disabled, no
 * cookie is present, or the token is invalid/expired. Use this in API route
 * handlers to enforce server-side, row-level scoping.
 */
export function getIdentitySessionFromRequest(
  request: Request,
): IdentitySession | null {
  if (!isIdentityModeEnabled()) return null;
  const token = getCookieValue(request, COOKIE_IDENTITY);
  if (!token) return null;
  return verifyIdentitySession(token);
}

/**
 * Resolve the effective per-user scope for a request. A `developer` is always
 * forced to their own login regardless of any client-supplied `user` value, so
 * a crafted `?user=<other-login>` can never read another user's rows. Admins
 * (and open / shared-password modes where there is no identity session) keep the
 * requested value. The returned `user` is lowercased for case-insensitive
 * matching against stored `user_login` values.
 */
export function resolveUserScope(
  session: IdentitySession | null,
  requestedUser: string | null | undefined,
): { user: string | null; forced: boolean } {
  if (session && session.role === "developer") {
    return { user: session.login.toLowerCase(), forced: true };
  }
  return {
    user: requestedUser == null ? null : requestedUser.toLowerCase(),
    forced: false,
  };
}

/* ── Auth Guards ── */

/**
 * Verify the caller has dashboard-level authentication.
 * Returns null if access is allowed, or a 401 response to return immediately.
 */
export function requireDashboardAuth(request: Request): NextResponse | null {
  if (!process.env.DASHBOARD_PASSWORD) return null; // open access

  const token = getCookieValue(request, COOKIE_DASHBOARD);
  if (token && verifySessionToken(token, "dashboard")) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/**
 * Verify the caller has admin-level authentication.
 * Returns null if access is allowed, or a 401 response to return immediately.
 */
export function requireAdminAuth(request: Request): NextResponse | null {
  if (!process.env.ADMIN_PASSWORD) return null; // open access

  const token = getCookieValue(request, COOKIE_ADMIN);
  if (token && verifySessionToken(token, "admin")) return null;

  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/* ── Error Sanitization ── */

/** Return a safe error message — real message in dev, generic fallback in prod. */
export function safeErrorMessage(err: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "development") {
    return err instanceof Error ? err.message : fallback;
  }
  return fallback;
}

/**
 * Return the real error message, suitable for admin-gated UIs where users
 * need diagnostic detail (e.g. Settings → Data Sync). Do NOT use for
 * endpoints reachable by non-admin users.
 */
export function adminErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
