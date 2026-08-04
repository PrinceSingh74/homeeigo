# Stage D — enable controlled event processing on staging Cloud Run.
# Requires STAGING_EVENTS_CERTIFICATION=1 (staging-safety opt-in).
# STAGING ONLY — never use on production.
param(
  [Parameter(Mandatory = $true)]
  [string]$CommitSha,
  [switch]$OutboxOnly,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$SQL_INSTANCE = "homigo-staging-step6a-pitr-20260803"
$CONNECTOR = "homigo-staging-vpc"
$SA = "homigo-backend-staging"
$REPO = "homigo"
$SERVICE = "homigo-backend-staging"
$IMAGE = "${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/backend:${CommitSha}"
$SHORT = $CommitSha.Substring(0, 7)
$CONN = "${PROJECT}:${REGION}:${SQL_INSTANCE}"
$SA_EMAIL = "${SA}@${PROJECT}.iam.gserviceaccount.com"

$eventEnv = "STAGING_EVENTS_CERTIFICATION=1,EVENTS_OUTBOX_ENABLED=true"
if (-not $OutboxOnly) {
  $eventEnv += ",EVENTS_CONSUMERS_ENABLED=true,EVENTS_BOOKING_ENABLED=true,EVENTS_PAYMENT_ENABLED=true,EVENTS_TRACKING_ENABLED=true,EVENTS_PARTNER_ENABLED=true"
} else {
  $eventEnv += ",EVENTS_CONSUMERS_ENABLED=false,EVENTS_BOOKING_ENABLED=true,EVENTS_PAYMENT_ENABLED=false,EVENTS_TRACKING_ENABLED=true,EVENTS_PARTNER_ENABLED=true"
}

$baseEnv = "NODE_ENV=production,APP_ENV=staging,SENTRY_ENVIRONMENT=staging,$eventEnv"

Write-Host "Stage D deploy — commit=$CommitSha outboxOnly=$OutboxOnly"
Write-Host "Event env: $eventEnv"

if ($DryRun) {
  Write-Host "[DRY RUN] Would deploy $IMAGE with Stage D event flags"
  exit 0
}

& "$PSScriptRoot\staging-gcp-deploy.ps1" -CommitSha $CommitSha

# Re-deploy same image with Stage D env overrides (staging-gcp-deploy pins events OFF)
gcloud run deploy $SERVICE `
  --project=$PROJECT `
  --region=$REGION `
  --image=$IMAGE `
  --service-account=$SA_EMAIL `
  --min-instances=2 `
  --max-instances=4 `
  --add-cloudsql-instances=$CONN `
  --vpc-connector=$CONNECTOR `
  --vpc-egress=private-ranges-only `
  --set-env-vars=$baseEnv `
  --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_REFRESH_SECRET=STAGING_JWT_REFRESH_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,OTP_SECRET=STAGING_OTP_SECRET:latest,OPS_AUTH_TOKEN=STAGING_OPS_AUTH_TOKEN:latest,RAZORPAY_KEY_ID=STAGING_RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=STAGING_RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=STAGING_RAZORPAY_WEBHOOK_SECRET:latest,RESEND_API_KEY=STAGING_RESEND_API_KEY:latest"

$url = gcloud run services describe $SERVICE --region=$REGION --project=$PROJECT --format="value(status.url)"
Write-Host "Stage D URL: $url"
Write-Host "Verify: curl $url/health && EVENTS flags on revision"
