# Step 9 — minimal event smoke via STAGE_D_SCRIPT_B64 (container has no scripts/ dir).
# STAGING ONLY. Read-only on schema — does NOT run prisma migrate deploy.
param(
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$JOB = "homigo-step9-event-smoke"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"

# Reuse inline harness from homigo-staging-migrate (absolute /app paths for runtime image).
$b64 = (gcloud run jobs describe homigo-staging-migrate --project=$PROJECT --region=$REGION --format="value(spec.template.spec.template.spec.containers[0].env.filter(name:STAGE_D_SCRIPT_B64).value)" 2>$null)
if (-not $b64) {
  throw "STAGE_D_SCRIPT_B64 not found on homigo-staging-migrate — cannot run smoke harness"
}

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
  "STAGE_D_SCRIPT_B64=$b64"
) -join ","

$runCmd = "echo `"`$STAGE_D_SCRIPT_B64`" | base64 -d > /tmp/stage-d-cert.ts && bun /tmp/stage-d-cert.ts"

Write-Host "Deploying $JOB (STAGE_D_SCRIPT_B64 harness, no migrate deploy)"

if ($DryRun) { Write-Host "[DRY RUN] Would deploy and execute"; exit 0 }

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
  --task-timeout=600 `
  --set-env-vars=$eventEnv `
  --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,RAZORPAY_KEY_ID=STAGING_RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=STAGING_RAZORPAY_KEY_SECRET:latest"

gcloud run jobs execute $JOB --project=$PROJECT --region=$REGION --wait
