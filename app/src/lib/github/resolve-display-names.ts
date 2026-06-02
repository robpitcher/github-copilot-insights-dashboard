const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_GRAPHQL = "https://api.github.com/graphql";
const API_VERSION = "2026-03-10";
const BATCH_SIZE = 20;
/** GraphQL allows many aliased lookups per request; keep well under node limits. */
const GRAPHQL_BATCH_SIZE = 100;

/** Sanitize an index into a safe GraphQL alias. */
function aliasFor(index: number): string {
  return `u${index}`;
}

/**
 * Resolve display names for a batch of logins using a single GraphQL request.
 * Returns a Map<login, displayName> for the logins that resolved with a name.
 * Throws if the GraphQL request itself fails (caller falls back to REST).
 */
async function resolveDisplayNamesGraphQL(
  logins: string[],
  token: string
): Promise<Map<string, string>> {
  const displayNameMap = new Map<string, string>();
  if (logins.length === 0) return displayNameMap;

  const aliases = logins.map((login, i) => {
    const alias = aliasFor(i);
    return `${alias}: user(login: ${JSON.stringify(login)}) { login name }`;
  });
  const query = `query { ${aliases.join(" ")} }`;

  const res = await fetch(GITHUB_GRAPHQL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    data?: Record<string, { login: string; name: string | null } | null>;
  };

  // GraphQL returns partial data even when some aliases error (e.g. missing
  // user). Read whatever resolved; unresolved aliases are simply skipped.
  const data = json.data ?? {};
  for (const value of Object.values(data)) {
    if (value && value.name) {
      displayNameMap.set(value.login, value.name);
    }
  }

  return displayNameMap;
}

/**
 * Resolve display names for a batch of logins using `GET /users/{login}`.
 * Best-effort: failed lookups are silently skipped.
 */
async function resolveDisplayNamesRest(
  logins: string[],
  token: string
): Promise<Map<string, string>> {
  const displayNameMap = new Map<string, string>();

  for (let i = 0; i < logins.length; i += BATCH_SIZE) {
    const batch = logins.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(async (login) => {
        const res = await fetch(
          `${GITHUB_API_BASE}/users/${encodeURIComponent(login)}`,
          {
            headers: {
              Accept: "application/vnd.github+json",
              Authorization: "Bearer " + token,
              "X-GitHub-Api-Version": API_VERSION,
            },
          }
        );
        if (res.ok) {
          const user = await res.json();
          if (user.name) displayNameMap.set(login, user.name);
        }
      })
    );
    for (const r of results) {
      if (r.status === "rejected") {
        console.debug("Failed to fetch user profile:", r.reason);
      }
    }
  }

  return displayNameMap;
}

/**
 * Resolve GitHub display names for a list of logins.
 *
 * Uses a batched GraphQL lookup (up to GRAPHQL_BATCH_SIZE logins per request via
 * aliased `user(login:)` fields), which collapses what would be dozens of REST
 * calls into a handful of requests. Falls back to the per-login REST endpoint
 * when GraphQL is unavailable (e.g. token lacks GraphQL access). Best-effort:
 * logins that fail to resolve are simply omitted.
 *
 * Returns a Map<login, displayName>.
 */
export async function resolveDisplayNames(
  logins: string[],
  token: string
): Promise<Map<string, string>> {
  const unique = [...new Set(logins.filter(Boolean))];
  const displayNameMap = new Map<string, string>();
  if (unique.length === 0) return displayNameMap;

  for (let i = 0; i < unique.length; i += GRAPHQL_BATCH_SIZE) {
    const batch = unique.slice(i, i + GRAPHQL_BATCH_SIZE);
    try {
      const resolved = await resolveDisplayNamesGraphQL(batch, token);
      for (const [login, name] of resolved) displayNameMap.set(login, name);
    } catch (err) {
      console.debug("GraphQL display-name lookup failed; falling back to REST:", err);
      const resolved = await resolveDisplayNamesRest(batch, token);
      for (const [login, name] of resolved) displayNameMap.set(login, name);
    }
  }

  return displayNameMap;
}

/**
 * Format a user label as "Display Name (username)" or just "username" if no display name.
 */
export function formatUserLabel(
  login: string,
  displayNameMap: Map<string, string>
): string {
  const name = displayNameMap.get(login);
  return name ? `${name} (${login})` : login;
}
