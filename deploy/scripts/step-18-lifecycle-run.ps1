#!/usr/bin/env pwsh
# Step 18 lifecycle certification — continues after AM redeploy + Slack gate PASS
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
$PollMinutes = 22

function Invoke-Vm([string]$Cmd) {
  $out = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command=$Cmd 2>&1
  return ($out | Where-Object { $_ -notmatch '^python\.exe|^WARNING:|^At ' }) -join "`n"
}

Write-Host "=== Cleanup prior synthetic state ==="
$ScriptPath = "D:\homigo\deploy\scripts\stage-f-step-18-alert-cert.ts"
$b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($ScriptPath))
$cleanupEnv = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,STEP18_CLEANUP=1,STEP18_SCRIPT_B64=$b64"
$runCmd = 'echo "$STEP18_SCRIPT_B64" | base64 -d > /tmp/step18.ts && bun /tmp/step18.ts'
gcloud run jobs deploy homigo-step18-final-cert --project=$PROJECT --region=$REGION --image=$IMAGE --command=sh --args="-c,$runCmd" --set-cloudsql-instances=$SQL --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only --service-account=$SA --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 --set-env-vars=$cleanupEnv --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest" 2>&1 | Out-Null
$cleanupExec = gcloud run jobs execute homigo-step18-final-cert --project=$PROJECT --region=$REGION --wait --format="value(status.succeededCount)" 2>&1 | Select-Object -Last 1
Write-Host "Cleanup succeededCount: $cleanupExec"

Write-Host "=== Sync obs bundle to VM ==="
$opsToken = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$PROJECT 2>&1 | Select-Object -Last 1).Trim()
New-Item -ItemType Directory -Force -Path "$OBS_DIR\secrets" | Out-Null
Set-Content -Path "$OBS_DIR\secrets\ops-token" -Value $opsToken -NoNewline
Push-Location $OBS_DIR
tar -czf "$env:TEMP\obs-staging-step18.tar.gz" prometheus.yml alertmanager-staging.yml docker-compose.yml grafana rules secrets/ops-token step18-cert-vm.sh 2>$null
Pop-Location
gcloud compute scp "$env:TEMP\obs-staging-step18.tar.gz" "${VM}:~/obs-staging-step18.tar.gz" --project=$PROJECT --zone=$ZONE --quiet 2>&1 | Out-Null
Invoke-Vm "mkdir -p ~/obs-staging && tar -xzf ~/obs-staging-step18.tar.gz -C ~/obs-staging && chmod +x ~/obs-staging/step18-cert-vm.sh" | Out-Null

Write-Host "=== promtool validation ==="
$validation = Invoke-Vm "bash ~/obs-staging/step18-cert-vm.sh validate"
Write-Host $validation

Write-Host "=== Deploy consumer-fail injector ==="
$injPath = "D:\homigo\deploy\scripts\stage-f-step-18-consumer-fail-injector.ts"
$injB64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($injPath))
$injEnv = "STEP18_FAIL_SCRIPT_B64=$injB64,STEP18_FAIL_DURATION_SEC=1200,STEP18_FAIL_RATE=3"
$injCmd = 'echo "$STEP18_FAIL_SCRIPT_B64" | base64 -d > /tmp/inj.ts && bun /tmp/inj.ts'
gcloud run deploy homigo-step18-fail-injector --project=$PROJECT --region=$REGION --image=$IMAGE --command=sh --args="-c,$injCmd" --port=8080 --allow-unauthenticated --min-instances=1 --max-instances=1 --memory=512Mi --cpu=1 --no-cpu-throttling --timeout=900 --set-env-vars=$injEnv 2>&1 | Out-Null
$injUrl = (gcloud run services describe homigo-step18-fail-injector --project=$PROJECT --region=$REGION --format="value(status.url)" 2>&1 | Select-Object -Last 1).Trim()
$injHost = ([Uri]$injUrl).Host
Write-Host "Injector deployed: host=$injHost"

Write-Host "=== Patch Prometheus scrape (single restart) ==="
$baseProm = Get-Content "$OBS_DIR\prometheus.yml" -Raw
if ($baseProm -notmatch 'homigo-step18-fail-injector') {
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
  Set-Content -Path "$OBS_DIR\prometheus.yml" -Value ($baseProm + $promPatch)
}
Set-Content -Path "$OBS_DIR\secrets\ops-token" -Value $opsToken -NoNewline
Push-Location $OBS_DIR
tar -czf "$env:TEMP\obs-prom-patch.tar.gz" prometheus.yml secrets/ops-token
Pop-Location
gcloud compute scp "$env:TEMP\obs-prom-patch.tar.gz" "${VM}:~/obs-prom-patch.tar.gz" --project=$PROJECT --zone=$ZONE --quiet 2>&1 | Out-Null
$promRestart = Invoke-Vm "cd ~/obs-staging && tar -xzf ~/obs-prom-patch.tar.gz && export GRAFANA_ADMIN_PASSWORD=placeholder && sudo -E docker-compose restart prometheus && sleep 15 && curl -sf http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22homigo-backend-staging%22%7D | grep -o '""1""' && echo SCRAPE_STABLE"
Write-Host $promRestart

Write-Host "=== Start poll loop in background ($PollMinutes min) ==="
$pollStart = Invoke-Vm "nohup env POLL_FILE=/tmp/step18-final-poll.jsonl bash ~/obs-staging/step18-cert-vm.sh poll-loop $PollMinutes > /tmp/step18-poll-loop.log 2>&1 & echo POLL_STARTED"
Write-Host $pollStart

Write-Host "=== Inject synthetic conditions runId=$runId ==="
$eventEnv = "NODE_ENV=production,APP_ENV=staging,STAGING_EVENTS_CERTIFICATION=1,EVENTS_OUTBOX_ENABLED=true,EVENTS_CONSUMERS_ENABLED=true,STEP18_RUN_ID=$runId,STEP18_SCRIPT_B64=$b64"
gcloud run jobs deploy homigo-step18-final-cert --project=$PROJECT --region=$REGION --image=$IMAGE --command=sh --args="-c,$runCmd" --set-cloudsql-instances=$SQL --vpc-connector=homigo-staging-vpc --vpc-egress=private-ranges-only --service-account=$SA --memory=1Gi --cpu=1 --max-retries=0 --task-timeout=900 --set-env-vars=$eventEnv --set-secrets="DATABASE_URL=STAGING_DATABASE_URL:latest,REDIS_URL=STAGING_REDIS_URL:latest" 2>&1 | Out-Null
$injExec = gcloud run jobs execute homigo-step18-final-cert --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)" 2>&1 | Select-Object -Last 1
Write-Host "Injection job: $injExec"

Write-Host "=== Waiting $PollMinutes minutes for alert lifecycles ==="
Start-Sleep -Seconds ($PollMinutes * 60 + 30)

Write-Host "=== Collect poll + AM evidence ==="
$pollData = Invoke-Vm "wc -l /tmp/step18-final-poll.jsonl; cat /tmp/step18-final-poll.jsonl"
$pollLines = @($pollData -split "`n" | Where-Object { $_ -match '^\{' })
$pollLines | Set-Content "$EVIDENCE\step-18-final-poll.jsonl"
$amLogs = Invoke-Vm "bash ~/obs-staging/step18-cert-vm.sh am-logs"
$amLogs | Set-Content "$EVIDENCE\step-18-am-logs-final.txt"
$slackMetrics = Invoke-Vm "curl -sf http://localhost:9093/metrics | grep slack"
$slackMetrics | Set-Content "$EVIDENCE\step-18-slack-metrics-final.txt"

Write-Host "=== Final cleanup ==="
gcloud run jobs execute homigo-step18-final-cert --project=$PROJECT --region=$REGION --update-env-vars=$cleanupEnv --wait 2>&1 | Out-Null
gcloud run services delete homigo-step18-fail-injector --project=$PROJECT --region=$REGION --quiet 2>&1 | Out-Null

Start-Sleep -Seconds 60
$finalMetrics = Invoke-Vm "curl -sf 'http://localhost:9090/api/v1/query?query=homigo_outbox_pending'; echo; curl -sf 'http://localhost:9090/api/v1/query?query=homigo_dlq_unresolved'"
Write-Host $finalMetrics
Write-Host "=== DONE runId=$runId pollSamples=$($pollLines.Count) ==="
