# Step 18 — Full alert lifecycle + Slack delivery on permanent obs stack (STAGING ONLY).
param(
  [string]$SlackWebhookUrl = "",
  [switch]$SkipConsumerFail,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$ZONE = "asia-south1-b"
$VM = "homigo-obs-staging"
$OBS_DIR = "D:\homigo\deploy\observability\staging"
$runId = "stage18-full-$(Get-Date -Format 'yyyyMMddHHmmss')"

function Get-AlertStates {
  $raw = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command="curl -sf 'http://localhost:9090/api/v1/alerts'" 2>&1 | Select-Object -Last 1
  $names = @("EventOutboxBacklogHigh","EventOutboxOldestPendingStale","EventConsumerFailureRateHigh","EventDlqGrowing","ScheduledJobLagHigh")
  $out = @{}
  foreach ($n in $names) {
    if ($raw -match "`"alertname`":`"$n`"[^}]*`"state`":`"(\w+)`"") { $out[$n] = $Matches[1] } else { $out[$n] = "inactive" }
  }
  return $out
}

function Wait-AlertState {
  param([string]$Name, [string[]]$Want, [int]$TimeoutSec = 900)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $s = (Get-AlertStates)[$Name]
    if ($Want -contains $s) { return $s }
    Start-Sleep -Seconds 20
  }
  return (Get-AlertStates)[$Name]
}

if (-not $SlackWebhookUrl) {
  try {
    $SlackWebhookUrl = (gcloud secrets versions access latest --secret=STAGING_SLACK_WEBHOOK_URL --project=$PROJECT 2>$null).Trim()
  } catch {}
}
if (-not $SlackWebhookUrl) {
  throw "STAGING_SLACK_WEBHOOK_URL required. Pass -SlackWebhookUrl or create secret first."
}

Write-Host "=== Redeploy Alertmanager with Slack webhook ==="
$opsToken = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$PROJECT).Trim()
$grafanaPass = (gcloud secrets versions access latest --secret=STAGING_GRAFANA_ADMIN_PASSWORD --project=$PROJECT).Trim()
New-Item -ItemType Directory -Force -Path "$OBS_DIR\secrets" | Out-Null
Set-Content -Path "$OBS_DIR\secrets\ops-token" -Value $opsToken -NoNewline
$env:STAGING_SLACK_WEBHOOK_URL = $SlackWebhookUrl
$env:GRAFANA_ADMIN_PASSWORD = $grafanaPass

if (-not $DryRun) {
  Push-Location $OBS_DIR
  tar -czf "$env:TEMP\obs-staging.tar.gz" .
  gcloud compute scp "$env:TEMP\obs-staging.tar.gz" "${VM}:~/obs-staging.tar.gz" --project=$PROJECT --zone=$ZONE --quiet
  gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command="mkdir -p ~/obs-staging && tar -xzf ~/obs-staging.tar.gz -C ~/obs-staging && cd ~/obs-staging && STAGING_SLACK_WEBHOOK_URL='$SlackWebhookUrl' GRAFANA_ADMIN_PASSWORD='$grafanaPass' docker-compose up -d"
  Pop-Location
}

Write-Host "=== Baseline alert states ==="
$baseline = Get-AlertStates
$baseline | ConvertTo-Json

Write-Host "=== Inject synthetic conditions ==="
# reuse stage-f-step-18-alert-cert.ts via cloud run job (existing pattern)
$ScriptPath = "D:\homigo\deploy\scripts\stage-f-step-18-alert-cert.ts"
$bytes = [System.IO.File]::ReadAllBytes($ScriptPath)
$b64 = [Convert]::ToBase64String($bytes)
$eventEnv = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,EVENTS_OUTBOX_ENABLED=true,EVENTS_CONSUMERS_ENABLED=true,STEP18_RUN_ID=$runId,STEP18_SCRIPT_B64=$b64"
$runCmd = 'echo "$STEP18_SCRIPT_B64" | base64 -d > /tmp/step18.ts && bun /tmp/step18.ts'
gcloud run jobs deploy homigo-step18-full-cert --project=$PROJECT --region=$REGION --image=asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154 --command=sh --args="-c,$runCmd" --set-cloudsql-instances=homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803 --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only --service-account=homigo-backend-staging@homigo-497619.iam.gserviceaccount.com --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 --set-env-vars=$eventEnv --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest" | Out-Null
gcloud run jobs execute homigo-step18-full-cert --project=$PROJECT --region=$REGION --wait | Out-Null

Write-Host "=== Poll pending states (T+2m) ==="
Start-Sleep -Seconds 120
$pending = Get-AlertStates
$pending | ConvertTo-Json

Write-Host "=== Wait firing: OutboxBacklog (for 10m), Stale (5m), DLQ (15m) ==="
$fb = Wait-AlertState -Name "EventOutboxBacklogHigh" -Want @("pending","firing") -TimeoutSec 720
$fs = Wait-AlertState -Name "EventOutboxOldestPendingStale" -Want @("pending","firing") -TimeoutSec 420
$fd = Wait-AlertState -Name "EventDlqGrowing" -Want @("pending","firing") -TimeoutSec 1020
Write-Host "OutboxBacklog=$fb Stale=$fs DLQ=$fd"

if (-not $SkipConsumerFail) {
  Write-Host "=== Deploy consumer-fail injector sidecar ==="
  $injPath = "D:\homigo\deploy\scripts\stage-f-step-18-consumer-fail-injector.ts"
  $injB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($injPath))
  $injEnv = "STEP18_FAIL_SCRIPT_B64=$injB64,STEP18_FAIL_DURATION_SEC=660,STEP18_FAIL_RATE=2"
  $injCmd = 'echo "$STEP18_FAIL_SCRIPT_B64" | base64 -d > /tmp/inj.ts && bun /tmp/inj.ts'
  gcloud run deploy homigo-step18-fail-injector --project=$PROJECT --region=$REGION --image=asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154 --command=sh --args="-c,$injCmd" --port=8080 --allow-unauthenticated --min-instances=1 --max-instances=1 --memory=512Mi --cpu=1 --timeout=900 --set-env-vars=$injEnv 2>&1 | Select-Object -Last 3
  $injUrl = gcloud run services describe homigo-step18-fail-injector --project=$PROJECT --region=$REGION --format="value(status.url)"
  Write-Host "Injector URL: $injUrl (add scrape target manually if needed)"
}

Write-Host "=== Cleanup synthetic rows ==="
$cleanupEnv = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,STEP18_CLEANUP=1,STEP18_SCRIPT_B64=$b64"
gcloud run jobs execute homigo-step18-full-cert --project=$PROJECT --region=$REGION --update-env-vars=$cleanupEnv --wait | Out-Null

Write-Host "=== Final alert states ==="
Start-Sleep -Seconds 60
$final = Get-AlertStates
$final | ConvertTo-Json
Write-Host "STEP18_RUN_ID=$runId"
