# Step 10 — Real staging booking lifecycle certification via Cloud Run Job.
# STAGING ONLY. Does NOT migrate or redeploy application RC.
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$JOB = "homigo-step10-booking-cert"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"
$ScriptPath = Join-Path $PSScriptRoot "stage-d-step-10-booking-cert.ts"

if (-not (Test-Path $ScriptPath)) {
  throw "Step 10 script not found: $ScriptPath"
}

$bytes = [System.IO.File]::ReadAllBytes($ScriptPath)
$b64 = [Convert]::ToBase64String($bytes)

$eventEnv = @(
  "NODE_ENV=production",
  "APP_ENV=staging",
  "STAGING_EVENTS_CERTIFICATION=1",
  "EVENTS_OUTBOX_ENABLED=true",
  "EVENTS_CONSUMERS_ENABLED=true",
  "EVENTS_BOOKING_ENABLED=true",
  "EVENTS_PAYMENT_ENABLED=true",
  "EVENTS_TRACKING_ENABLED=true",
  "EVENTS_PARTNER_ENABLED=true",
  "STEP10_SCRIPT_B64=$b64"
) -join ","

$runCmd = 'echo "$STEP10_SCRIPT_B64" | base64 -d > /tmp/step10-cert.ts && bun /tmp/step10-cert.ts'

Write-Host "Deploying $JOB (Step 10 booking lifecycle cert, image $IMAGE)"

if ($DryRun) {
  Write-Host "[DRY RUN] Would deploy and execute job"
  exit 0
}

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
  --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_REFRESH_SECRET=STAGING_JWT_REFRESH_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,OTP_SECRET=STAGING_OTP_SECRET:latest,RAZORPAY_KEY_ID=STAGING_RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=STAGING_RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=STAGING_RAZORPAY_WEBHOOK_SECRET:latest"

$execName = gcloud run jobs execute $JOB --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)"
Write-Host "Execution: $execName"
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$JOB" --project=$PROJECT --limit=80 --format="value(textPayload)" 2>$null
