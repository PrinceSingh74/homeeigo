# Step 18 FINAL certification orchestrator - STAGING ONLY
# Never prints STAGING_SLACK_WEBHOOK_URL
param(
  [int]$PollMinutes = 22
)

$ErrorActionPreference = "Continue"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$ZONE = "asia-south1-b"
$VM = "homigo-obs-staging"
$OBS_DIR = "D:\homigo\deploy\observability\staging"
$EVIDENCE = "D:\homigo\docs\evidence\stage-f-remediation"
$runId = "stage18-final-$(Get-Date -Format 'yyyyMMddHHmmss')"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"

function Invoke-Vm {
  param([string]$Cmd)
  $out = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command=$Cmd 2>&1
  return ($out | Where-Object { $_ -notmatch '^python\.exe|^WARNING:|^At ' }) -join "`n"
}

function Get-AlertSnapshot {
  $raw = Invoke-Vm "curl -sf 'http://localhost:9090/api/v1/alerts'"
  $names = @("EventOutboxBacklogHigh","EventOutboxOldestPendingStale","EventConsumerFailureRateHigh","EventDlqGrowing","ScheduledJobLagHigh")
  $snap = @{ ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ") }
  foreach ($n in $names) {
    if ($raw -match "`"alertname`":`"$n`".*?`"state`":`"(\w+)`"") { $snap[$n] = $Matches[1] }
    elseif ($raw -match "`"alertname`":`"$n`"") { $snap[$n] = "unknown" }
    else { $snap[$n] = "inactive" }
  }
  return $snap
}

Write-Host "=== Step 18 FINAL - secret existence check (no value read) ==="
$secretCheck = gcloud secrets describe STAGING_SLACK_WEBHOOK_URL --project=$PROJECT --format="value(name)" 2>&1
$slackConfigured = ($LASTEXITCODE -eq 0)
if (-not $slackConfigured) {
  $vmSecretCheck = Invoke-Vm "gcloud secrets describe STAGING_SLACK_WEBHOOK_URL --project=$PROJECT --format=value(name) 2>/dev/null && echo OK || echo MISSING"
  $slackConfigured = ($vmSecretCheck -match "OK")
}
Write-Host "STAGING_SLACK_WEBHOOK_URL present: $slackConfigured"

Write-Host "=== Sync obs configs to VM ==="
$opsToken = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$PROJECT 2>&1 | Select-Object -Last 1).Trim()
$grafanaPass = (gcloud secrets versions access latest --secret=STAGING_GRAFANA_ADMIN_PASSWORD --project=$PROJECT 2>&1 | Select-Object -Last 1).Trim()
New-Item -ItemType Directory -Force -Path "$OBS_DIR\secrets" | Out-Null
Set-Content -Path "$OBS_DIR\secrets\ops-token" -Value $opsToken -NoNewline
Push-Location $OBS_DIR
tar -czf "$env:TEMP\obs-staging-step18.tar.gz" prometheus.yml alertmanager-staging.yml docker-compose.yml grafana rules secrets/ops-token step18-cert-vm.sh 2>$null
Pop-Location
gcloud compute scp "$env:TEMP\obs-staging-step18.tar.gz" "${VM}:~/obs-staging-step18.tar.gz" --project=$PROJECT --zone=$ZONE --quiet 2>&1 | Out-Null
Invoke-Vm "mkdir -p ~/obs-staging && tar -xzf ~/obs-staging-step18.tar.gz -C ~/obs-staging && chmod +x ~/obs-staging/step18-cert-vm.sh" | Out-Null

Write-Host "=== Redeploy Alertmanager with secret from VM ==="
$amStatus = Invoke-Vm "bash ~/obs-staging/step18-cert-vm.sh redeploy-am"
Write-Host $amStatus

Write-Host "=== promtool + Alertmanager validation ==="
$validation = Invoke-Vm "bash ~/obs-staging/step18-cert-vm.sh validate; curl -sf http://localhost:9093/-/healthy && echo AM_HEALTH_OK"
Write-Host $validation

Write-Host "=== Baseline snapshot ==="
$baseline = Get-AlertSnapshot
$baseline | ConvertTo-Json | Set-Content "$EVIDENCE\step-18-baseline-snapshot.json"

Write-Host "=== Deploy consumer-fail injector sidecar ==="
$injPath = "D:\homigo\deploy\scripts\stage-f-step-18-consumer-fail-injector.ts"
$injB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($injPath))
$injEnv = "STEP18_FAIL_SCRIPT_B64=$injB64,STEP18_FAIL_DURATION_SEC=900,STEP18_FAIL_RATE=3"
$injCmd = 'echo "$STEP18_FAIL_SCRIPT_B64" | base64 -d > /tmp/inj.ts && bun /tmp/inj.ts'
gcloud run deploy homigo-step18-fail-injector --project=$PROJECT --region=$REGION --image=$IMAGE --command=sh --args="-c,$injCmd" --port=8080 --allow-unauthenticated --min-instances=1 --max-instances=1 --memory=512Mi --cpu=1 --no-cpu-throttling --timeout=900 --set-env-vars=$injEnv 2>&1 | Select-Object -Last 2
$injUrl = (gcloud run services describe homigo-step18-fail-injector --project=$PROJECT --region=$REGION --format="value(status.url)" 2>&1 | Select-Object -Last 1).Trim()
$injHost = ([Uri]$injUrl).Host
Write-Host "Injector host configured (URL not stored in evidence): host=$injHost"

Write-Host "=== Add injector scrape target to Prometheus ==="
$promPatch = @"
  - job_name: homigo-step18-fail-injector
    metrics_path: /metrics
    scheme: https
    static_configs:
      - targets:
          - $injHost
        labels:
          service: homigo-step18-fail-injector
          environment: staging
          certification: step18
"@
Set-Content -Path "$OBS_DIR\prometheus-step18.yml" -Value (Get-Content "$OBS_DIR\prometheus.yml" -Raw)
Add-Content -Path "$OBS_DIR\prometheus-step18.yml" -Value $promPatch
Set-Content -Path "$OBS_DIR\secrets\ops-token" -Value $opsToken -NoNewline
Push-Location $OBS_DIR
Copy-Item prometheus-step18.yml prometheus.yml -Force
tar -czf "$env:TEMP\obs-prom-patch.tar.gz" prometheus.yml secrets/ops-token
Pop-Location
gcloud compute scp "$env:TEMP\obs-prom-patch.tar.gz" "${VM}:~/obs-prom-patch.tar.gz" --project=$PROJECT --zone=$ZONE --quiet 2>&1 | Out-Null
Invoke-Vm "cd ~/obs-staging && tar -xzf ~/obs-prom-patch.tar.gz && sudo docker-compose restart prometheus 2>/dev/null || sudo docker compose restart prometheus; sleep 10; curl -sf http://localhost:9090/-/ready && echo PROM_RELOAD_OK" | Out-Null

Write-Host "=== Inject synthetic outbox/stale/dlq conditions ==="
$ScriptPath = "D:\homigo\deploy\scripts\stage-f-step-18-alert-cert.ts"
$b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($ScriptPath))
$eventEnv = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,EVENTS_OUTBOX_ENABLED=true,EVENTS_CONSUMERS_ENABLED=true,STEP18_RUN_ID=$runId,STEP18_SCRIPT_B64=$b64"
$runCmd = 'echo "$STEP18_SCRIPT_B64" | base64 -d > /tmp/step18.ts && bun /tmp/step18.ts'
gcloud run jobs deploy homigo-step18-final-cert --project=$PROJECT --region=$REGION --image=$IMAGE --command=sh --args="-c,$runCmd" --set-cloudsql-instances=$SQL --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only --service-account=$SA --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 --set-env-vars=$eventEnv --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest" 2>&1 | Out-Null
$injExec = gcloud run jobs execute homigo-step18-final-cert --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)" 2>&1 | Select-Object -Last 1
Write-Host "Injection job: $injExec"

Write-Host "=== Poll alert states for $PollMinutes minutes ==="
Invoke-Vm "bash ~/obs-staging/step18-cert-vm.sh poll-loop $PollMinutes" | Out-Null
$pollData = Invoke-Vm "cat /tmp/step18-poll.jsonl"
$pollLines = @($pollData -split "`n" | Where-Object { $_.Trim().Length -gt 0 })
$pollLines | Set-Content "$EVIDENCE\step-18-poll-raw.jsonl"

Write-Host "=== Alertmanager sanitized logs ==="
$amLogs = Invoke-Vm "bash ~/obs-staging/step18-cert-vm.sh am-logs"
$amLogs | Set-Content "$EVIDENCE\step-18-am-logs-sanitized.txt"

Write-Host "=== Cleanup synthetic state + stop injector ==="
$cleanupEnv = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,STEP18_CLEANUP=1,STEP18_SCRIPT_B64=$b64"
gcloud run jobs execute homigo-step18-final-cert --project=$PROJECT --region=$REGION --update-env-vars=$cleanupEnv --wait 2>&1 | Out-Null
gcloud run services delete homigo-step18-fail-injector --project=$PROJECT --region=$REGION --quiet 2>&1 | Out-Null

Start-Sleep -Seconds 90
$finalSnap = Get-AlertSnapshot
$finalMetrics = Invoke-Vm "curl -sf 'http://localhost:9090/api/v1/query?query=homigo_outbox_pending'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=homigo_dlq_unresolved'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=sum(rate(homigo_consumer_failed_total[5m]))'"

Write-Host "=== Done runId=$runId ==="
Write-Host "Poll samples: $($pollLines.Count)"
