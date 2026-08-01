param(
  [Parameter(Mandatory = $true)]
  [string]$CommitSha
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$SQL_INSTANCE = "homigo-staging-db"
$CONNECTOR = "homigo-staging-vpc"
$SA = "homigo-backend-staging"
$REPO = "homigo"
$SERVICE = "homigo-backend-staging"
$IMAGE = "${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/backend:${CommitSha}"
$SHORT = $CommitSha.Substring(0, 7)
$IMAGE_SHORT = "${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/backend:${SHORT}"

Write-Host "Building image from clean worktree at $CommitSha ..."
$worktree = Join-Path $env:TEMP "homigo-staging-build-$SHORT"
if (Test-Path $worktree) { Remove-Item -Recurse -Force $worktree }
git -C D:\homigo worktree add $worktree $CommitSha --detach
try {
  gcloud builds submit $worktree/apps/backend `
    --tag $IMAGE `
    --tag $IMAGE_SHORT `
    --project=$PROJECT
} finally {
  git -C D:\homigo worktree remove $worktree --force 2>$null
}

$CONN = "${PROJECT}:${REGION}:${SQL_INSTANCE}"
$SA_EMAIL = "${SA}@${PROJECT}.iam.gserviceaccount.com"

gcloud run deploy $SERVICE `
  --project=$PROJECT `
  --region=$REGION `
  --image=$IMAGE `
  --service-account=$SA_EMAIL `
  --port=8080 `
  --min-instances=2 `
  --max-instances=4 `
  --cpu=1 `
  --memory=1Gi `
  --no-cpu-throttling `
  --concurrency=40 `
  --timeout=30 `
  --ingress=all `
  --allow-unauthenticated `
  --add-cloudsql-instances=$CONN `
  --vpc-connector=$CONNECTOR `
  --vpc-egress=private-ranges-only `
  --set-env-vars="NODE_ENV=production,APP_ENV=staging,SENTRY_ENVIRONMENT=staging,EVENTS_OUTBOX_ENABLED=false,EVENTS_CONSUMERS_ENABLED=false" `
  --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_REFRESH_SECRET=STAGING_JWT_REFRESH_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,OTP_SECRET=STAGING_OTP_SECRET:latest,RAZORPAY_KEY_ID=STAGING_RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=STAGING_RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=STAGING_RAZORPAY_WEBHOOK_SECRET:latest,RESEND_API_KEY=STAGING_RESEND_API_KEY:latest"

gcloud run services describe $SERVICE --region=$REGION --project=$PROJECT --format="value(status.url)"
