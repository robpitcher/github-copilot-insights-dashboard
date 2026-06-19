#!/usr/bin/env bash
#
# ai-credit-user-spike.sh — reproducible per-user x per-model AI Credit report.
#
# Demonstrates the spike findings in docs/ai-credit-user-data-spike.md: the
# enterprise `ai_credit/usage` endpoint does NOT return a per-user dimension by
# default, but accepts a case-insensitive `user` filter. This script enumerates
# Copilot seats and queries the endpoint once per user to produce per-user x
# per-model rows (credits + USD) for a given month.
#
# Requirements:
#   - GitHub CLI (`gh`) authenticated with a CLASSIC personal access token that
#     has the `manage_billing:enterprise` (read) scope, owned by an enterprise
#     admin/billing manager. Fine-grained PATs do NOT work for billing endpoints.
#     Pass it via `GH_TOKEN` or `gh auth login`.
#
# Usage:
#   ./scripts/ai-credit-user-spike.sh <enterprise-slug> [year] [month]
#
# Examples:
#   ./scripts/ai-credit-user-spike.sh my-enterprise 2026 6
#   GH_TOKEN=ghp_xxx ./scripts/ai-credit-user-spike.sh my-enterprise

set -euo pipefail

API_VERSION="2026-03-10"

ENTERPRISE="${1:-}"
YEAR="${2:-$(date -u +%Y)}"
MONTH="${3:-$(date -u +%-m)}"

if [[ -z "$ENTERPRISE" ]]; then
  echo "Usage: $0 <enterprise-slug> [year] [month]" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI (gh) is required." >&2
  exit 1
fi

echo "# AI Credit usage — enterprise=$ENTERPRISE year=$YEAR month=$MONTH" >&2
echo "# Enumerating Copilot seats..." >&2

# 1) Collect seat logins (paginated, deduped, lowercased for the join key).
mapfile -t logins < <(
  gh api --paginate \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: $API_VERSION" \
    "/enterprises/$ENTERPRISE/copilot/billing/seats?per_page=100" \
    --jq '.seats[].assignee.login' \
    | tr '[:upper:]' '[:lower:]' | sort -u
)

echo "# Found ${#logins[@]} seat(s). Querying per-user AI Credit usage..." >&2

# CSV header for the per-user x per-model matrix.
echo "user,model,sku,gross_credits,net_credits,gross_usd,net_usd"

# 2) Query the AI Credit usage report once per user (the `user` filter is the
#    only way to obtain a per-user breakdown — the response is otherwise
#    aggregated by (product, sku, model)).
for login in "${logins[@]}"; do
  gh api \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: $API_VERSION" \
    "/enterprises/$ENTERPRISE/settings/billing/ai_credit/usage?year=$YEAR&month=$MONTH&user=$login" \
    --jq --arg user "$login" '
      .usageItems[]
      | [$user, .model, .sku, .grossQuantity, .netQuantity, .grossAmount, .netAmount]
      | @csv
    ' || echo "# warning: usage query failed for user=$login" >&2
done
