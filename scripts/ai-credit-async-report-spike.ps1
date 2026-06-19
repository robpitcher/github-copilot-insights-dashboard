<#
.SYNOPSIS
ai-credit-async-report-spike.ps1 - test the async AI Credit usage report export.

.DESCRIPTION
Creates a GitHub billing usage report export with report_type=ai_credit,
polls until the report completes, downloads the CSV file(s), and validates that
the expected per-user/per-model columns are present.

This tests the bulk alternative documented in docs/ai-credit-user-data-spike.md:
POST /enterprises/{enterprise}/settings/billing/reports
followed by polling GET /enterprises/{enterprise}/settings/billing/reports/{id}.

.PARAMETER Enterprise
The enterprise slug.

.PARAMETER StartDate
Start date in YYYY-MM-DD format. Defaults to the first day of the current UTC month.

.PARAMETER EndDate
End date in YYYY-MM-DD format. Defaults to the current UTC date. For scheduled ingest,
consider passing yesterday to avoid partial current-day billing data.

.PARAMETER OutputPath
CSV output path. Defaults to ai-credit-report-<enterprise>-<start>-to-<end>.csv
in the current directory. If the report returns multiple download URLs, the script
adds .partN before the extension.

.PARAMETER PollIntervalSeconds
Seconds between report status checks. Defaults to 15.

.PARAMETER TimeoutMinutes
Maximum time to wait for the async report to complete. Defaults to 15.

.PARAMETER ReportId
Optional existing report ID to poll instead of creating a new export.

.EXAMPLE
.\scripts\ai-credit-async-report-spike.ps1 -Enterprise my-enterprise -StartDate 2026-06-01 -EndDate 2026-06-18

.EXAMPLE
.\scripts\ai-credit-async-report-spike.ps1 my-enterprise -EndDate 2026-06-17 -OutputPath .\ai-credit-mtd.csv

.NOTES
Requirements:
  - GitHub CLI (gh) authenticated with a CLASSIC personal access token owned by
    an enterprise admin/billing manager.
  - GitHub billing usage endpoints do not support fine-grained PATs.
  - The empirically validated billing scope is manage_billing:enterprise (read).
#>

param(
    [Parameter(Mandatory=$true, Position=0)]
    [string]$Enterprise,

    [Parameter(Mandatory=$false)]
    [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
    [string]$StartDate,

    [Parameter(Mandatory=$false)]
    [ValidatePattern('^\d{4}-\d{2}-\d{2}$')]
    [string]$EndDate,

    [Parameter(Mandatory=$false)]
    [string]$OutputPath,

    [Parameter(Mandatory=$false)]
    [ValidateRange(1, 3600)]
    [int]$PollIntervalSeconds = 15,

    [Parameter(Mandatory=$false)]
    [ValidateRange(1, 1440)]
    [int]$TimeoutMinutes = 15,

    [Parameter(Mandatory=$false)]
    [string]$ReportId
)

$ErrorActionPreference = "Stop"
$API_VERSION = "2026-03-10"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "error: GitHub CLI (gh) is required."
    exit 1
}

$todayUtc = [DateTime]::UtcNow.Date
if (-not $StartDate) {
    $StartDate = ([DateTime]::new($todayUtc.Year, $todayUtc.Month, 1, 0, 0, 0, [DateTimeKind]::Utc)).ToString("yyyy-MM-dd")
}
if (-not $EndDate) {
    $EndDate = $todayUtc.ToString("yyyy-MM-dd")
}

$culture = [Globalization.CultureInfo]::InvariantCulture
$startDateValue = [DateTime]::ParseExact($StartDate, "yyyy-MM-dd", $culture)
$endDateValue = [DateTime]::ParseExact($EndDate, "yyyy-MM-dd", $culture)

if ($endDateValue -lt $startDateValue) {
    Write-Error "error: EndDate must be on or after StartDate."
    exit 1
}

if (($endDateValue - $startDateValue).TotalDays -gt 30) {
    Write-Error "error: AI Credit usage reports are documented with a maximum 31-day inclusive window."
    exit 1
}

if (-not $OutputPath) {
    $safeEnterprise = $Enterprise -replace '[^A-Za-z0-9._-]', '-'
    $OutputPath = Join-Path (Get-Location) "ai-credit-report-$safeEnterprise-$StartDate-to-$EndDate.csv"
}

Write-Host "# AI Credit async report export" -ForegroundColor Gray
Write-Host "# enterprise=$Enterprise start_date=$StartDate end_date=$EndDate" -ForegroundColor Gray

if (-not $ReportId) {
    Write-Host "# Creating report export..." -ForegroundColor Gray
    $createJson = & gh api `
        --method POST `
        -H "Accept: application/vnd.github+json" `
        -H "X-GitHub-Api-Version: $API_VERSION" `
        "/enterprises/$Enterprise/settings/billing/reports" `
        -f report_type="ai_credit" `
        -f start_date="$StartDate" `
        -f end_date="$EndDate" `
        -F send_email=false

    $created = $createJson | ConvertFrom-Json
    $ReportId = $created.id
    if (-not $ReportId) {
        Write-Error "error: report creation response did not include an id."
        exit 1
    }
    Write-Host "# report_id=$ReportId status=$($created.status)" -ForegroundColor Gray
} else {
    Write-Host "# Polling existing report_id=$ReportId" -ForegroundColor Gray
}

$deadline = [DateTime]::UtcNow.AddMinutes($TimeoutMinutes)
$report = $null
while ($true) {
    $statusJson = & gh api `
        -H "Accept: application/vnd.github+json" `
        -H "X-GitHub-Api-Version: $API_VERSION" `
        "/enterprises/$Enterprise/settings/billing/reports/$ReportId"

    $report = $statusJson | ConvertFrom-Json
    Write-Host "# status=$($report.status)" -ForegroundColor Gray

    if ($report.status -eq "completed") {
        break
    }
    if ($report.status -eq "failed") {
        Write-Error "error: report export failed."
        exit 1
    }
    if ([DateTime]::UtcNow -ge $deadline) {
        Write-Error "error: timed out waiting for report_id=$ReportId after $TimeoutMinutes minute(s)."
        exit 1
    }

    Start-Sleep -Seconds $PollIntervalSeconds
}

$downloadUrls = @($report.download_urls)
if ($downloadUrls.Count -eq 0) {
    Write-Error "error: completed report did not include any download_urls."
    exit 1
}

$downloadedPaths = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $downloadUrls.Count; $i++) {
    $targetPath = $OutputPath
    if ($downloadUrls.Count -gt 1) {
        $directory = Split-Path -Parent $OutputPath
        $fileName = [IO.Path]::GetFileNameWithoutExtension($OutputPath)
        $extension = [IO.Path]::GetExtension($OutputPath)
        if (-not $directory) {
            $directory = "."
        }
        $targetPath = Join-Path $directory "$fileName.part$($i + 1)$extension"
    }

    Write-Host "# Downloading CSV part $($i + 1) of $($downloadUrls.Count) to $targetPath" -ForegroundColor Gray
    Invoke-WebRequest -Uri $downloadUrls[$i] -OutFile $targetPath
    $downloadedPaths.Add((Resolve-Path $targetPath).Path)
}

$requiredColumns = @("date", "username", "model", "quantity", "gross_amount", "discount_amount", "net_amount")
foreach ($path in $downloadedPaths) {
    $header = Get-Content -Path $path -TotalCount 1
    if (-not $header) {
        Write-Error "error: downloaded CSV is empty: $path"
        exit 1
    }

    $columns = $header.Split(",") | ForEach-Object { $_.Trim('"') }
    $missingColumns = @($requiredColumns | Where-Object { $_ -notin $columns })
    if ($missingColumns.Count -gt 0) {
        Write-Error "error: downloaded CSV is missing expected column(s): $($missingColumns -join ', ')"
        exit 1
    }
}

Write-Host "# Download complete. Expected AI Credit columns are present." -ForegroundColor Green
foreach ($path in $downloadedPaths) {
    Write-Output $path
}
