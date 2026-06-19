<#
.SYNOPSIS
ai-credit-user-spike.ps1 — reproducible per-user × per-model AI Credit report.

.DESCRIPTION
Demonstrates the spike findings in docs/ai-credit-user-data-spike.md: the
enterprise `ai_credit/usage` endpoint does NOT return a per-user dimension by
default, but accepts a case-insensitive `user` filter. This script enumerates
Copilot seats and queries the endpoint once per user to produce per-user ×
per-model rows (credits + USD) for a given month.

.PARAMETER Enterprise
The enterprise slug (required).

.PARAMETER Year
The year for the report (default: current year in UTC).

.PARAMETER Month
The month for the report (default: current month in UTC).

.EXAMPLE
.\scripts\ai-credit-user-spike.ps1 -Enterprise my-enterprise -Year 2026 -Month 6

.EXAMPLE
.\scripts\ai-credit-user-spike.ps1 my-enterprise

.NOTES
Requirements:
  - GitHub CLI (gh) authenticated with a CLASSIC personal access token that
    has the `manage_billing:enterprise` (read) scope, owned by an enterprise
    admin/billing manager. Fine-grained PATs do NOT work for billing endpoints.
    Pass it via GH_TOKEN environment variable or authenticate with `gh auth login`.
#>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Enterprise,

    [Parameter(Mandatory=$false, Position=1)]
    [int]$Year = (Get-Date -AsUTC).Year,

    [Parameter(Mandatory=$false, Position=2)]
    [int]$Month = (Get-Date -AsUTC).Month
)

$ErrorActionPreference = "Stop"
$API_VERSION = "2026-03-10"

# Check if gh CLI is available
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "error: GitHub CLI (gh) is required."
    exit 1
}

Write-Host "# AI Credit usage — enterprise=$Enterprise year=$Year month=$Month" -ForegroundColor Gray
Write-Host "# Enumerating Copilot seats..." -ForegroundColor Gray

# 1) Collect seat logins (paginated, deduped, lowercased for the join key).
$logins = @(
    gh api --paginate -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: $API_VERSION" "/enterprises/$Enterprise/copilot/billing/seats?per_page=100" --jq '.seats[].assignee.login' |
    ForEach-Object { $_.ToLower() } |
    Sort-Object -Unique
)

Write-Host "# Found $($logins.Count) seat(s). Querying per-user AI Credit usage..." -ForegroundColor Gray

# CSV header for the per-user × per-model matrix.
"user,model,sku,gross_credits,net_credits,gross_usd,net_usd"

# 2) Query the AI Credit usage report once per user (the `user` filter is the
#    only way to obtain a per-user breakdown — the response is otherwise
#    aggregated by (product, sku, model)).
foreach ($login in $logins) {
    try {
        $jqFilter = ".usageItems[] | [`"$login`", .model, .sku, .grossQuantity, .netQuantity, .grossAmount, .netAmount] | @csv"
        & gh api -H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: $API_VERSION" "/enterprises/$Enterprise/settings/billing/ai_credit/usage?year=$Year&month=$Month&user=$login" --jq $jqFilter
    } catch {
        Write-Host "# warning: usage query failed for user=$login" -ForegroundColor Gray
    }
}
