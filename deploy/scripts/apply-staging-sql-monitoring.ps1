# Apply Homigo staging Cloud SQL monitoring (non-destructive).
# Creates log-based metrics (if missing) and alert policies.
# Does NOT modify databases or secrets.
$ErrorActionPreference = "Stop"
$Project = "homigo-497619"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not (Test-Path "$Root/deploy/monitoring")) { $Root = "D:\homigo" }

function Ensure-LogMetric($Name, $Description, $FilterFile) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & gcloud logging metrics describe $Name --project=$Project 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {
    $filter = (Get-Content -Raw $FilterFile).Trim()
    gcloud logging metrics create $Name --project=$Project --description=$Description --log-filter="$filter"
    if ($LASTEXITCODE -ne 0) { throw "Failed to create log metric $Name" }
  }
}

Ensure-LogMetric "homigo_staging_sql_backup_failure" "Staging Cloud SQL backup failure" "$Root/deploy/monitoring/log-filters/staging-backup-failure.filter"
Ensure-LogMetric "homigo_staging_sql_backup_success" "Staging Cloud SQL backup success" "$Root/deploy/monitoring/log-filters/staging-backup-success.filter"

$policies = @(
  "staging-sql-backup-failure.json",
  "staging-sql-stale-backup.json",
  "staging-sql-instance-down.json"
)

foreach ($file in $policies) {
  $path = Join-Path "$Root/deploy/monitoring/alert-policies" $file
  $name = [System.IO.Path]::GetFileNameWithoutExtension($file)
  $existing = gcloud monitoring policies list --project=$Project --filter="displayName:Homigo Staging Cloud SQL" --format="value(name)" 2>$null
  $display = (Get-Content $path -Raw | ConvertFrom-Json).displayName
  $found = gcloud monitoring policies list --project=$Project --format="json" 2>$null | ConvertFrom-Json | Where-Object { $_.displayName -eq $display }
  if (-not $found) {
    Write-Host "Creating alert policy: $display"
    gcloud monitoring policies create --project=$Project --policy-from-file=$path
    if ($LASTEXITCODE -ne 0) { throw "Failed to create policy $display" }
  } else {
    Write-Host "Policy already exists: $display"
  }
}

Write-Host "Done. Attach notification channels in Cloud Console if not yet configured."
