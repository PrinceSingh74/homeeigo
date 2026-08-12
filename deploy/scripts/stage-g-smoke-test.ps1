# Quick smoke test - 2 sequential bookings with unique fixtures
$ErrorActionPreference = "Continue"
$ScriptsDir = "D:\homigo\deploy\scripts"
$runId = "stageG-smoke-$(Get-Date -Format 'yyyyMMddHHmmss')"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"

function Deploy-Booking {
  param([string]$Seq)
  $ScriptPath = "$ScriptsDir\stage-g-booking-workload.ts"
  $bytes = [System.IO.File]::ReadAllBytes($ScriptPath)
  $b64 = [Convert]::ToBase64String($bytes)
  $envStr = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,EVENTS_OUTBOX_ENABLED=true,EVENTS_CONSUMERS_ENABLED=true,EVENTS_BOOKING_ENABLED=true,EVENTS_PAYMENT_ENABLED=true,EVENTS_TRACKING_ENABLED=true,EVENTS_PARTNER_ENABLED=true,STAGE_G_RUN_ID=$runId,STAGE_G_SEQ=$Seq,STAGE_G_SCRIPT_B64=$b64"
  $runCmd = 'echo "$STAGE_G_SCRIPT_B64" | base64 -d > /tmp/stage-g.ts && bun /tmp/stage-g.ts'
  gcloud run jobs deploy homigo-stage-g-booking-smoke --project=$PROJECT --region=$REGION --image=$IMAGE `
    --command=sh --args="-c,$runCmd" --set-cloudsql-instances=$SQL --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only `
    --service-account=$SA --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 --set-env-vars=$envStr `
    --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_REFRESH_SECRET=STAGING_JWT_REFRESH_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,OTP_SECRET=STAGING_OTP_SECRET:latest" 2>&1 | Out-Null
  $execOut = @(gcloud run jobs execute homigo-stage-g-booking-smoke --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)" 2>&1)
  $exec = $execOut | Where-Object { $_ -match "^homigo-" } | Select-Object -First 1
  $failed = (gcloud run jobs executions describe $exec --project=$PROJECT --region=$REGION --format="value(status.failedCount)" 2>&1 | Select-Object -Last 1).Trim()
  Write-Host "seq=$Seq execution=$exec failed=$failed"
  return ($failed -ne "1")
}

Write-Host "Smoke test runId=$runId"
$r1 = Deploy-Booking "1"
$r2 = Deploy-Booking "2"
if ($r1 -and $r2) { Write-Host "SMOKE_TEST_PASS"; exit 0 } else { Write-Host "SMOKE_TEST_FAIL"; exit 1 }
