# Step 15 — Event idempotency / duplicate delivery certification via Cloud Run Job.
# STAGING ONLY. Does NOT migrate, redeploy staging service, or touch production.
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$JOB = "homigo-step15-idempotency-cert"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"
$SECRET = "STAGING_STEP15_SCRIPT"
$ScriptPath = Join-Path $PSScriptRoot "stage-e-step-15-idempotency-cert.ts"

if (-not (Test-Path $ScriptPath)) {
  $ScriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) "..\apps\backend\scripts\stage-e-step-15-idempotency-cert.ts"
}
if (-not (Test-Path $ScriptPath)) {
  throw "Step 15 script not found"
}

$secretExists = $false
try {
  gcloud secrets describe $SECRET --project=$PROJECT 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $secretExists = $true }
} catch {}
if (-not $secretExists) {
  gcloud secrets create $SECRET --project=$PROJECT --replication-policy="automatic"
  gcloud secrets add-iam-policy-binding $SECRET --project=$PROJECT `
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" | Out-Null
}
gcloud secrets versions add $SECRET --project=$PROJECT --data-file=$ScriptPath | Out-Null

$envFile = Join-Path $env:TEMP "step15-cert-env.yaml"
@"
NODE_ENV: production
APP_ENV: staging
STAGING_EVENTS_CERTIFICATION: "1"
EVENTS_OUTBOX_ENABLED: "true"
EVENTS_CONSUMERS_ENABLED: "true"
EVENTS_BOOKING_ENABLED: "true"
EVENTS_PAYMENT_ENABLED: "true"
EVENTS_TRACKING_ENABLED: "true"
EVENTS_PARTNER_ENABLED: "true"
"@ | Set-Content -Path $envFile -Encoding UTF8

$runCmd = "cd /app && bun /secrets/step15-cert.ts"

Write-Host "Deploying $JOB (Step 15 idempotency cert, image $IMAGE)"

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
  --env-vars-file=$envFile `
  --set-secrets="/secrets/step15-cert.ts=${SECRET}:latest,DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest"

$execName = gcloud run jobs execute $JOB --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)"
Write-Host "Execution: $execName"
if ($execName) {
  gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$JOB AND labels.run.googleapis.com/execution_name=$execName" --project=$PROJECT --limit=400 --format="value(textPayload)" --freshness=60m 2>$null
}
