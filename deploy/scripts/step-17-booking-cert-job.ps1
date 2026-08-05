# Step 17 - Fresh booking lifecycle cert against permanent Prometheus/Grafana (STAGING ONLY).
param([switch]$DryRun)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$ZONE = "asia-south1-b"
$VM = "homigo-obs-staging"
$JOB = "homigo-step17-booking-cert"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"
$ScriptPath = Join-Path $PSScriptRoot "stage-f-step-17-booking-cert.ts"
$runId = "stage17-$(Get-Date -Format 'yyyyMMddHHmmss')"

if (-not (Test-Path $ScriptPath)) { throw "Missing $ScriptPath" }

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
  "STEP17_RUN_ID=$runId",
  "STEP17_SCRIPT_B64=$b64"
) -join ","

$runCmd = 'echo "$STEP17_SCRIPT_B64" | base64 -d > /tmp/step17-cert.ts && bun /tmp/step17-cert.ts'

Write-Host "=== STEP 17 baseline Prometheus permanent stack ==="
$baseline = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command="curl -sf 'http://localhost:9090/api/v1/query?query=sum(homigo_outbox_publish_total%7Bresult%3D%22success%22%7D)'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=sum(homigo_domain_event_total%7Bevent_type%3D%22booking.created%22%7D)'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=sum(rate(homigo_domain_event_total%5B5m%5D))'" 2>&1 | Select-Object -Last 6
Write-Host $baseline

if ($DryRun) { Write-Host 'DRY RUN'; exit 0 }

Write-Host "=== Deploy and execute $JOB runId=$runId ==="
gcloud run jobs deploy $JOB `
  --project=$PROJECT --region=$REGION --image=$IMAGE `
  --command=sh --args="-c,$runCmd" `
  --set-cloudsql-instances=$SQL `
  --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only `
  --service-account=$SA --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 `
  --set-env-vars=$eventEnv `
  --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_REFRESH_SECRET=STAGING_JWT_REFRESH_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,OTP_SECRET=STAGING_OTP_SECRET:latest,RAZORPAY_KEY_ID=STAGING_RAZORPAY_KEY_ID:latest,RAZORPAY_KEY_SECRET=STAGING_RAZORPAY_KEY_SECRET:latest,RAZORPAY_WEBHOOK_SECRET=STAGING_RAZORPAY_WEBHOOK_SECRET:latest"

$execName = gcloud run jobs execute $JOB --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)"
Write-Host "Execution: $execName"

Start-Sleep -Seconds 25
Write-Host "=== STEP 17 after Prometheus ==="
$after = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command="curl -sf 'http://localhost:9090/api/v1/query?query=sum(homigo_outbox_publish_total%7Bresult%3D%22success%22%7D)'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=sum(homigo_domain_event_total%7Bevent_type%3D%22booking.created%22%7D)'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=sum(rate(homigo_domain_event_total%5B5m%5D))'" 2>&1 | Select-Object -Last 6
Write-Host $after

Write-Host "=== Job logs ==="
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$JOB" --project=$PROJECT --limit=40 --format="value(textPayload)" 2>&1 | Select-Object -First 30

Write-Host "STEP17_RUN_ID=$runId"
