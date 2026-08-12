# Verify remediated booking + payment harness before full soak
$ErrorActionPreference = "Continue"
$ScriptsDir = "D:\homigo\deploy\scripts"
$runId = "stageG-verify-$(Get-Date -Format 'yyyyMMddHHmmss')"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"

function Ensure-SecretFromFile {
  param([string]$SecretName, [string]$FilePath)
  $exists = $false
  try { gcloud secrets describe $SecretName --project=$PROJECT 2>$null | Out-Null; if ($LASTEXITCODE -eq 0) { $exists = $true } } catch {}
  if (-not $exists) {
    gcloud secrets create $SecretName --project=$PROJECT --replication-policy="automatic" 2>&1 | Out-Null
    gcloud secrets add-iam-policy-binding $SecretName --project=$PROJECT --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" 2>&1 | Out-Null
  }
  gcloud secrets versions add $SecretName --project=$PROJECT --data-file=$FilePath 2>&1 | Out-Null
}

$SECRET = "STAGING_STAGE_G_BOOKING_SCRIPT"
$ScriptPath = "$ScriptsDir\stage-g-booking-workload.ts"
Ensure-SecretFromFile -SecretName $SECRET -FilePath $ScriptPath
$envFile = Join-Path $env:TEMP "stage-g-booking-verify.yaml"
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
STAGE_G_RUN_ID: "$runId"
STAGE_G_SEQ: "0"
"@ | Set-Content -Path $envFile -Encoding UTF8
$runCmd = "cd /app && bun /secrets/stage-g-booking.ts"
gcloud run jobs deploy homigo-stage-g-booking --project=$PROJECT --region=$REGION --image=$IMAGE `
  --command=sh --args="-c,$runCmd" --set-cloudsql-instances=$SQL --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only `
  --service-account=$SA --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 --env-vars-file=$envFile `
  --set-secrets="/secrets/stage-g-booking.ts=${SECRET}:latest,DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest,JWT_SECRET=STAGING_JWT_SECRET:latest,JWT_REFRESH_SECRET=STAGING_JWT_REFRESH_SECRET:latest,ENCRYPTION_KEY=STAGING_ENCRYPTION_KEY:latest,OTP_SECRET=STAGING_OTP_SECRET:latest" 2>&1 | Out-Null

$pass = 0
foreach ($seq in @("1","2","3")) {
  $exec = (gcloud run jobs execute homigo-stage-g-booking --project=$PROJECT --region=$REGION --wait `
    --update-env-vars="STAGE_G_RUN_ID=$runId,STAGE_G_SEQ=$seq" --format="value(metadata.name)" 2>&1 | Where-Object { $_ -match "^homigo-" } | Select-Object -First 1)
  $ok = (gcloud run jobs executions describe $exec --project=$PROJECT --region=$REGION --format="value(status.succeededCount)" 2>&1 | Select-Object -Last 1)
  Write-Host "seq=$seq exec=$exec succeeded=$ok"
  if ($ok -eq "1") { $pass++ }
}
if ($pass -eq 3) { Write-Host "HARNESS_VERIFY_PASS"; exit 0 } else { Write-Host "HARNESS_VERIFY_FAIL pass=$pass/3"; exit 1 }
