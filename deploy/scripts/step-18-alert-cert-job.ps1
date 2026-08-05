# Stage F Step 18 — Alert certification harness via Cloud Run Job (STAGING ONLY).
param(
  [switch]$Cleanup,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$JOB = "homigo-step18-alert-cert"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"
$ScriptPath = Join-Path $PSScriptRoot "stage-f-step-18-alert-cert.ts"

if (-not (Test-Path $ScriptPath)) {
  throw "Step 18 script not found: $ScriptPath"
}

$runId = "stage18-cert-$(Get-Date -Format 'yyyyMMddHHmmss')"
Write-Host "Deploying $JOB runId=$runId cleanup=$Cleanup"

if ($DryRun) { Write-Host "[DRY RUN]"; exit 0 }

$bytes = [System.IO.File]::ReadAllBytes($ScriptPath)
$b64 = [Convert]::ToBase64String($bytes)
$cleanupFlag = if ($Cleanup) { "1" } else { "0" }
$eventEnv = @(
  "NODE_ENV=production",
  "APP_ENV=staging",
  "STAGING_EVENTS_CERTIFICATION=1",
  "EVENTS_OUTBOX_ENABLED=true",
  "EVENTS_CONSUMERS_ENABLED=true",
  "EVENTS_BOOKING_ENABLED=true",
  "STEP18_RUN_ID=$runId",
  "STEP18_CLEANUP=$cleanupFlag",
  "STEP18_SCRIPT_B64=$b64"
) -join ","

$runCmd = 'echo "$STEP18_SCRIPT_B64" | base64 -d > /tmp/step18-cert.ts && bun /tmp/step18-cert.ts'

gcloud run jobs deploy $JOB `
  --project=$PROJECT `
  --region=$REGION `
  --image=$IMAGE `
  --command=sh `
  --args="-c,$runCmd" `
  --set-cloudsql-instances=$SQL `
  --vpc-connector=homigo-staging-vpc `
  --vpc-egress=private-ranges-only `
  --service-account=$SA `
  --memory=1Gi `
  --cpu=1 `
  --max-retries=0 `
  --task-timeout=900 `
  --set-env-vars=$eventEnv `
  --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest"

$execName = gcloud run jobs execute $JOB --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)"
Write-Host "Execution: $execName"
Write-Host "STEP18_RUN_ID=$runId"
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$JOB" --project=$PROJECT --limit=120 --format="value(textPayload)" --freshness=30m 2>$null
