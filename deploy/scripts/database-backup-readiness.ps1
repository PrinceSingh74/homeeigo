# Non-destructive Cloud SQL backup / PITR readiness verification.
# Does NOT restore, delete, or modify databases. Does NOT print secrets.
param(
  [string]$Project = "homigo-497619",
  [string]$Instance = "homigo-staging-db",
  [int]$MaxBackupAgeHours = 36
)

$ErrorActionPreference = "Stop"

function Invoke-GcloudJson {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $raw = & gcloud @Args --format=json 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  if ($code -ne 0) { throw "gcloud failed (exit $code): $raw" }
  return ($raw | ConvertFrom-Json)
}

Write-Host "=== Homigo Database Backup Readiness ==="
Write-Host "project=$Project instance=$Instance"

$inst = Invoke-GcloudJson sql instances describe $Instance --project=$Project
$backup = $inst.settings.backupConfiguration
$retention = $backup.backupRetentionSettings

$report = [ordered]@{
  timestampUtc          = (Get-Date).ToUniversalTime().ToString("o")
  project               = $Project
  instance              = $Instance
  state                 = $inst.state
  databaseVersion       = $inst.databaseVersion
  region                = $inst.region
  backupEnabled         = [bool]$backup.enabled
  pitrEnabled           = [bool]$backup.pointInTimeRecoveryEnabled
  backupStartTime       = $backup.startTime
  retainedBackups       = $retention.retainedBackups
  retentionUnit         = $retention.retentionUnit
  transactionLogDays    = $backup.transactionLogRetentionDays
  deletionProtection    = [bool]$inst.settings.deletionProtectionEnabled
  availabilityType      = $inst.settings.availabilityType
  ipv4Enabled           = [bool]$inst.settings.ipConfiguration.ipv4Enabled
  privateNetwork        = $inst.settings.ipConfiguration.privateNetwork
}

$backups = Invoke-GcloudJson sql backups list --instance=$Instance --project=$Project
$latest = $backups | Where-Object { $_.status -eq "SUCCESSFUL" } | Sort-Object -Property endTime -Descending | Select-Object -First 1
if ($latest) {
  $latestEnd = [datetime]::Parse($latest.endTime).ToUniversalTime()
  $ageHours = [math]::Round(((Get-Date).ToUniversalTime() - $latestEnd).TotalHours, 2)
  $report.latestBackupId     = $latest.id
  $report.latestBackupStatus = $latest.status
  $report.latestBackupEndUtc = $latest.endTime
  $report.latestBackupAgeHours = $ageHours
  $report.latestBackupType   = $latest.type
} else {
  $report.latestBackupStatus = "NONE"
}

$checks = @()
if (-not $report.backupEnabled) { $checks += "FAIL: automated backups disabled" }
if (-not $report.pitrEnabled) { $checks += "WARN: PITR disabled" }
if (-not $latest) { $checks += "FAIL: no successful backup found" }
elseif ($ageHours -gt $MaxBackupAgeHours) { $checks += "WARN: latest backup older than ${MaxBackupAgeHours}h ($ageHours h)" }
else { $checks += "PASS: recent successful backup ($ageHours h old)" }
if ($inst.state -ne "RUNNABLE") { $checks += "FAIL: instance state $($inst.state)" }
else { $checks += "PASS: instance RUNNABLE" }

if (-not $report.deletionProtection) { $checks += "FAIL: deletion protection disabled" }
else { $checks += "PASS: deletion protection enabled" }

$report.checks = $checks
$report.overall = if ($checks -match "^FAIL") { "FAIL" } elseif ($checks -match "^WARN") { "PARTIAL" } else { "PASS" }

$report | ConvertTo-Json -Depth 6
Write-Host "overall=$($report.overall)"
