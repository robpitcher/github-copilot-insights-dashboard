# Spike: Per-user × per-model AI Credit data source, shape, and scopes

**Issue:** [#2](https://github.com/robpitcher/github-copilot-insights-dashboard/issues/2) — part of the self-service epic ([#1](https://github.com/robpitcher/github-copilot-insights-dashboard/issues/1)).

**Status:** Complete — per-user × per-model AI Credit consumption **is obtainable** from the existing
`ai_credit/usage` endpoint, but **only by querying one user at a time** via the `user` filter. The
default (unfiltered) response is aggregated by `(product, sku, model)` and carries **no** per-user field.

> **Conclusion for the epic:** the data exists and is reachable with the credentials we already require.
> No schema change is needed. Issue C must change **ingest** to loop over enterprise members and call the
> endpoint once per user (or per `cost_center_id`) so that `fact_ai_credit_usage.user_login` is populated.

---

## TL;DR for issues B and C

| Question | Answer |
| --- | --- |
| Per-user field on the default response? | **No.** Default `usageItems` are aggregated by `(product, sku, model)`; there is no `user`, `date`, `organizationName`, or cost-center dimension in the line items. |
| How to get per-user × per-model rows? | Call the **same** `ai_credit/usage` endpoint **once per user** with the `user=<login>` query param. Each call returns that user's per-model rows (credits + USD). |
| Identity join key | GitHub `login`. The endpoint's `user` filter is **case-insensitive**; normalize to **lowercase** on both sides (OAuth login and `fact_ai_credit_usage.user_login`). |
| Required token | **Classic PAT** with **`manage_billing:enterprise`** scope (read), owned by an enterprise **admin/billing manager**. Fine-grained PATs and GitHub App tokens do **not** work for this endpoint. |
| API version header | `X-GitHub-Api-Version: 2026-03-10` (matches `API_VERSION` in `app/src/app/api/metrics/ai-credits/route.ts`). |

---

## 1. Does `ai_credit/usage` return a per-user `user` field?

**No — not by default.** The documented success response for
`GET /enterprises/{enterprise}/settings/billing/ai_credit/usage` returns line items aggregated by
`(product, sku, model)`:

```jsonc
{
  "timePeriod": { "year": 2025 },
  "enterprise": "GitHub",
  "usageItems": [
    {
      "product": "Copilot",
      "sku": "Copilot AI Credits",
      "model": "GPT-5",
      "unitType": "credits",
      "pricePerUnit": 0.01,
      "grossQuantity": 100,
      "grossAmount": 1,
      "discountQuantity": 0,
      "discountAmount": 0,
      "netQuantity": 100,
      "netAmount": 1
    }
  ]
}
```

There is **no** `user`, `date`, `organizationName`, `team`, or `cost_center` field on the aggregated
line item. This confirms the suspicion in the issue: the current ingest persists `(model, sku)` totals
with `user_login = NULL` because `normalizeItem()` reads `item.user`, which is absent on the default
(unfiltered) response.

Source: [REST API — Billing usage › Get billing AI credit usage report for an enterprise](https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage)
(`X-GitHub-Api-Version: 2026-03-10`).

## 2. Correct source for per-user, per-model consumption

The **same** `ai_credit/usage` endpoint is the correct source. It accepts a **`user`** query parameter
("The user name to query usage for. The name is not case sensitive."), alongside `year`, `month`, `day`,
`organization`, `model`, `product`, and `cost_center_id`.

To build the per-user × per-model matrix:

1. Enumerate enterprise Copilot seats (logins) — the route already fetches these from
   `GET /enterprises/{slug}/copilot/billing/seats` (`seats[].assignee.login`).
2. For **each** login, call `ai_credit/usage?year=&month=&user=<login>`. The returned `usageItems` are
   that user's rows broken down by model/sku (credits in `netQuantity`/`grossQuantity`, USD in
   `netAmount`/`grossAmount`).
3. Tag each row with the queried `login` (the response items themselves do not echo the user), and that
   becomes `fact_ai_credit_usage.user_login`.

Candidates considered and rejected as the primary source:

- **`/settings/billing/usage` (enhanced billing usage report):** returns Actions/Packages-style rows with
  `date`, `organizationName`, `repositoryName` — it does **not** break Copilot AI Credits down by model or
  by user, and is only available to enhanced-billing enterprises. Not a fit for per-user × per-model.
- **`/settings/billing/usage/summary`:** aggregated by `(product, sku)` only — coarser than `ai_credit/usage`.
- **Budgets "consumed amount" API:** exposes a `user` filter but returns budget consumption, not a
  per-model credit breakdown. Redundant given the `user` filter on `ai_credit/usage`.

> **No grouping/breakdown param** makes `ai_credit/usage` emit per-user line items in a single call. The
> per-user dimension is obtained by **filtering** (`user=`), i.e. one request per user.

## 3. Identity join key and normalization

- The join key is the GitHub **`login`** (handle), matching `fact_ai_credit_usage.user_login`.
- The endpoint's `user` filter is **case-insensitive**, and seat logins may differ in casing from a
  signed-in user's OAuth `login`. **Normalize to lowercase on both sides** before comparing/storing.
- Recommended rule for issues B and C: store `user_login` lowercased at ingest, and lowercase the
  signed-in OAuth `login` before querying. This guarantees an exact match for the self-service scoping.

The existing API route already lower-cases when filtering in memory
(`app/src/app/api/metrics/ai-credits/route.ts`, `parseCsvSet` and `usageMatchesFilters`), so the
convention is consistent — issue C should extend it to the persisted `user_login` column.

## 4. Required token scopes

- **Classic personal access token** with **`manage_billing:enterprise`** (read) scope.
- The token owner must be an enterprise **administrator or billing manager**.
- **Fine-grained PATs, GitHub App user tokens, and GitHub App installation tokens do not work** with the
  enterprise billing endpoints — a classic PAT is required.
- `read:enterprise` alone is **not** sufficient for billing data; `manage_billing:copilot` covers the
  Copilot seats endpoint but the AI Credit billing report wants `manage_billing:enterprise`.

These match the scopes already documented in `AGENTS.md` (Required PAT scopes:
`manage_billing:copilot (read)`, `read:org`, `read:enterprise`, `manage_billing:enterprise (read)`).

---

## Reproducible commands

A runnable helper lives at [`scripts/ai-credit-user-spike.sh`](../scripts/ai-credit-user-spike.sh). It
enumerates seats and prints per-user × per-model rows (credits + USD) for a given month.

### Single user, one model breakdown (`gh api`)

```bash
# Per-user, per-model AI Credit rows for one login (June 2026).
gh api \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "/enterprises/ENTERPRISE/settings/billing/ai_credit/usage?year=2026&month=6&user=octocat" \
  --jq '.usageItems[] | {user: "octocat", model, sku, credits: .netQuantity, usd: .netAmount}'
```

### All seats → per-user × per-model matrix (raw `gh api` loop)

```bash
ENTERPRISE="my-enterprise"; YEAR=2026; MONTH=6

# 1) Collect seat logins (paginated).
gh api --paginate \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "/enterprises/$ENTERPRISE/copilot/billing/seats?per_page=100" \
  --jq '.seats[].assignee.login' | sort -u > /tmp/seats.txt

# 2) Query AI Credit usage per user and emit one NDJSON row per (user, model).
while read -r login; do
  gh api \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2026-03-10" \
    "/enterprises/$ENTERPRISE/settings/billing/ai_credit/usage?year=$YEAR&month=$MONTH&user=$login" \
    --jq --arg user "$login" \
      '.usageItems[] | {user: ($user | ascii_downcase), model, sku,
                        grossCredits: .grossQuantity, netCredits: .netQuantity,
                        grossUsd: .grossAmount, netUsd: .netAmount}'
done < /tmp/seats.txt
```

`gh` injects the token automatically; ensure it is a classic PAT with `manage_billing:enterprise` (e.g.
`GH_TOKEN=ghp_xxx gh api ...`).

---

## Implications for issue C (ingest changes)

- **No schema change.** `fact_ai_credit_usage` already has `user_login`, `model`, `sku`, `net_quantity`,
  `net_amount`, `usage_date`, `org_name`, `team_name`, `cost_center`.
- Change `fetchUsageItems` (or the ingest path) to **loop over seat logins** and call `ai_credit/usage`
  with `user=<login>`, tagging each returned item with the lowercased queried login (the response does
  not echo the user).
- Optionally pass `day=` to capture daily granularity for `usage_date`; without it, rows are monthly.
- Store `user_login` **lowercased** so it joins exactly against a signed-in user's lowercased OAuth login.
- Be mindful of rate limits: one request per seat per month. Reuse the existing retry/back-off client and
  consider persisting snapshots so the self-service path can read from the DB instead of re-querying.
