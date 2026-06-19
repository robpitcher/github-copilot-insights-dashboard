# Spike: Per-user × per-model AI Credit data source, shape, and scopes

**Issue:** [#2](https://github.com/robpitcher/github-copilot-insights-dashboard/issues/2) — part of the self-service epic ([#1](https://github.com/robpitcher/github-copilot-insights-dashboard/issues/1)).

**Status:** Complete — per-user × per-model AI Credit consumption **is obtainable**, but there are
two different API paths with different operational trade-offs. The synchronous JSON
`ai_credit/usage` endpoint only exposes per-user data by querying one user at a time via the `user`
filter. The asynchronous billing report export API can produce a bulk `ai_credit` CSV grouped by
`date × model × username` for all users in a single export job.

> **Conclusion for the epic:** the data exists and is reachable with the credentials we already require.
> No schema change is needed. For daily/month-to-date ingestion, Issue C should prefer the async
> `ai_credit` report export path to avoid one request per user. The per-user `ai_credit/usage`
> loop remains a viable fallback or live-query path when synchronous JSON is required.

---

## TL;DR for issues B and C

| Question | Answer |
| --- | --- |
| Per-user field on the default response? | **No.** Default `usageItems` are aggregated by `(product, sku, model)`; there is no `user`, `date`, `organizationName`, or cost-center dimension in the line items. |
| Preferred bulk source for daily/month-to-date ingest? | **Async usage report export:** `POST /enterprises/{enterprise}/settings/billing/reports` with `report_type: "ai_credit"`, poll the report, then download/parse the CSV. The AI usage report is grouped by `date`, `model`, and `username`. |
| Synchronous JSON fallback? | Call the **same** `ai_credit/usage` endpoint **once per user** with the `user=<login>` query param. Each call returns that user's per-model rows (credits + USD), but this is rate-limit sensitive at larger seat counts. |
| Identity join key | GitHub `login`. The endpoint's `user` filter is **case-insensitive**; normalize to **lowercase** on both sides (OAuth login and `fact_ai_credit_usage.user_login`). |
| Required token | **Classic PAT**, owned by an enterprise **admin/billing manager**. GitHub's billing automation docs state billing usage endpoints do not support fine-grained PATs; `manage_billing:enterprise` (read) is the empirically validated scope for the billing endpoints. |
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

## 2. Correct sources for per-user, per-model consumption

There are two documented GitHub API paths that can produce per-user × per-model AI Credit data.
They should be treated as separate ingestion strategies, not as interchangeable endpoints.

### Option A — async `ai_credit` usage report export (preferred for scheduled ingest)

**Route:** `POST /enterprises/{enterprise}/settings/billing/reports`

**Body:**

```jsonc
{
  "report_type": "ai_credit",
  "start_date": "2026-06-01",
  "end_date": "2026-06-18",
  "send_email": false
}
```

The create call returns `202 Accepted` with a report `id` and `status: "processing"`. Poll
`GET /enterprises/{enterprise}/settings/billing/reports/{report_id}` until the status is
`completed`, then download the CSV from `download_urls`.

GitHub's billing reports reference documents the **AI usage report** as a per-user breakdown of AI
credits. It sums `quantity`, `gross_amount`, `discount_amount`, and `net_amount` based on the
combination of **`date`, `model`, and `username`**. That means one month-to-date export can populate
the target `username × model` table without enumerating seats or issuing one usage request per user.

Operational trade-offs:

- **Pros:** one export job per period, all users included, native daily granularity via `date`, native
  `username` and `model` columns, avoids per-seat API fanout and associated rate-limit pressure.
- **Cons:** asynchronous job lifecycle, CSV parsing instead of JSON, signed download URLs must be
  consumed promptly, max report window is documented as **31 days**, and the endpoint is enterprise
  billing infrastructure rather than a low-latency page-load API.

This path is the better fit for this application's scheduled ETL/backfill model. A daily refresh can
request month-to-date (`start_date` = first day of the month, `end_date` = today or yesterday) and
replace the persisted snapshot for the selected month. For reliability, prefer ingesting through
yesterday by default because billing data may lag and report dates are UTC-based; optionally allow a
"latest partial" current-day refresh if the UI needs it.

Sources:

- [REST API — Billing usage reports › Create a usage report export](https://docs.github.com/en/enterprise-cloud@latest/rest/billing/usage-reports)
- [Billing reports reference › AI usage report](https://docs.github.com/en/enterprise-cloud@latest/billing/reference/billing-reports)

### Option B — synchronous `ai_credit/usage` JSON endpoint (fallback/live path)

The `ai_credit/usage` endpoint accepts a **`user`** query parameter ("The user name to query usage
for. The name is not case sensitive."), alongside `year`, `month`, `day`, `organization`, `model`,
`product`, and `cost_center_id`.

To build the per-user × per-model matrix using this synchronous endpoint:

1. Enumerate enterprise Copilot seats (logins) — the route already fetches these from
   `GET /enterprises/{slug}/copilot/billing/seats` (`seats[].assignee.login`).
2. For **each** login, call `ai_credit/usage?year=&month=&user=<login>`. The returned `usageItems` are
   that user's rows broken down by model/sku (credits in `netQuantity`/`grossQuantity`, USD in
   `netAmount`/`grossAmount`).
3. Tag each row with the queried `login` (the response items themselves do not echo the user), and that
   becomes `fact_ai_credit_usage.user_login`.

This path is useful when the app needs a direct JSON response, but it scales linearly with seat count.
For a 5,000-seat enterprise, a month refresh becomes 5,000+ billing calls before retries, which is
much more likely to hit primary or secondary rate limits than the async export path.

Candidates considered and rejected as the primary source:

- **`/settings/billing/usage` (enhanced billing usage report):** returns Actions/Packages-style rows with
  `date`, `organizationName`, `repositoryName` — it does **not** break Copilot AI Credits down by model or
  by user, and is only available to enhanced-billing enterprises. Not a fit for per-user × per-model.
- **`/settings/billing/usage/summary`:** aggregated by `(product, sku)` only — coarser than `ai_credit/usage`.
- **Copilot usage metrics reports:** expose per-user/model engagement telemetry, but not AI Credit
  quantities, SKU pricing, gross/net amounts, or included-credit discounts. Useful for activity context,
  not billing.
- **Budgets "consumed amount" API:** exposes a `user` filter but returns budget consumption, not a
  per-model credit breakdown. Redundant given the `user` filter on `ai_credit/usage`.

> **Important distinction:** no grouping/breakdown param makes the synchronous `ai_credit/usage` JSON
> endpoint emit all per-user line items in one call. The async `ai_credit` report export is the bulk
> API route that provides all-user rows.

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

- **Classic personal access token** owned by an enterprise admin or billing manager.
- The token owner must be an enterprise **administrator or billing manager**.
- GitHub's billing automation docs state billing usage endpoints **do not support fine-grained PATs**.
- **`manage_billing:enterprise`** (read) is the empirically validated scope for these billing endpoints.
- **GitHub App user tokens and GitHub App installation tokens did not work** in testing for the
  enterprise billing endpoints; the endpoint reference docs do not currently spell out GitHub App token
  behavior.
- `read:enterprise` alone is **not** sufficient for billing data; `manage_billing:copilot` covers the
  Copilot seats endpoint but the AI Credit billing report wants `manage_billing:enterprise`.

These match the scopes already documented in `AGENTS.md` (Required PAT scopes:
`manage_billing:copilot (read)`, `read:org`, `read:enterprise`, `manage_billing:enterprise (read)`).

---

## Reproducible commands

A runnable helper lives at [`scripts/ai-credit-user-spike.sh`](../scripts/ai-credit-user-spike.sh). It
enumerates seats and prints per-user × per-model rows (credits + USD) for a given month.

### Async all-users month-to-date export (`gh api`)

```bash
ENTERPRISE="my-enterprise"
START_DATE="2026-06-01"
END_DATE="2026-06-18"

# 1) Create the async AI Credit report export.
REPORT_ID=$(
  gh api \
    --method POST \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2026-03-10" \
    "/enterprises/$ENTERPRISE/settings/billing/reports" \
    -f report_type="ai_credit" \
    -f start_date="$START_DATE" \
    -f end_date="$END_DATE" \
    -F send_email=false \
    --jq '.id'
)

# 2) Poll until complete, then read the first signed CSV URL.
gh api \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2026-03-10" \
  "/enterprises/$ENTERPRISE/settings/billing/reports/$REPORT_ID" \
  --jq '{status, download_urls}'
```

Once `status` is `completed`, download the CSV URL immediately and parse columns including `date`,
`username`, `model`, `sku`, `quantity`, `gross_amount`, `discount_amount`, and `net_amount`.

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
- Add an **async report ingestion path** that creates an `ai_credit` usage report export, polls report
  status, downloads the CSV, normalizes rows, and persists them to `fact_ai_credit_usage`.
- Do **not** run the async export/poll/download flow inside the page-load `GET /api/metrics/ai-credits`
  request. That route is currently synchronous and aggregates already-fetched items for charts and
  filters; report export belongs in the ETL/sync workflow so the dashboard reads persisted snapshots.
- Reuse the existing snapshot shape: map CSV `username` → lowercased `user_login`, `date` →
  `usage_date`, `quantity` → `gross_quantity` or `net_quantity` after confirming the report's unit
  semantics in live data, `gross_amount`/`discount_amount`/`net_amount` → the matching amount columns,
  and `model`/`sku`/`organization`/`cost_center_name` to their existing columns.
- Current `persistAiCreditSnapshot` deletes and reinserts all rows for an enterprise/year/month. That
  works for month-to-date refreshes if the export is treated as the authoritative snapshot for that
  month; late-arriving adjustments are handled by re-running the same month window.
- The async export path needs operational state that the current synchronous route does not have:
  report ID, requested date range, status (`processing`/`completed`/`failed`), timestamps, failure
  details, and possibly the latest successful ingest watermark. This can start as transient ETL state,
  but a persisted sync-status table would make retries and Settings-page visibility easier.
- Serialize report jobs per enterprise/month unless testing proves concurrent usage reports are allowed.
  The docs/UI note account-level report generation constraints, so the sync job should handle a 400/409
  style "report already running" response by retrying later instead of starting parallel exports.
- Signed `download_urls` should be treated as short-lived secrets: download immediately, do not persist
  them, and log only report IDs/statuses.
- Keep the per-user `ai_credit/usage?user=<login>` loop as a fallback or diagnostic path. If used, tag
  rows with the lowercased queried login because the response items do not echo the user; optionally pass
  `day=` for daily granularity.
