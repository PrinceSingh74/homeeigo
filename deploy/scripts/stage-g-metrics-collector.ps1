# Stage G metrics collector — polls every IntervalSec for SoakMinutes, writes JSONL.
param(
  [int]$SoakMinutes = 60,
  [int]$IntervalSec = 30,
  [string]$EvidenceDir = "D:\homigo\docs\evidence\stage-g-soak",
  [string]$RunId = "stageG"
)

$ErrorActionPreference = "Continue"
$PROJECT = "homigo-497619"
$ZONE = "asia-south1-b"
$VM = "homigo-obs-staging"
$samplesFile = Join-Path $EvidenceDir "stage-g-samples.jsonl"
$end = (Get-Date).AddMinutes($SoakMinutes)

function Scrape-Metrics {
  $ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  $sample = @{ ts = $ts; runId = $RunId }
  try {
    $token = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$PROJECT 2>$null | Select-Object -Last 1).Trim()
    if (-not $token) { $sample.error = "token_unavailable"; return $sample }
    $raw = curl.exe -s -H "Authorization: Bearer $token" "https://homigo-backend-staging-144968192234.asia-south1.run.app/metrics"
    if (-not $raw -or $raw.Length -lt 100) { $sample.error = "metrics_empty"; return $sample }
    foreach ($pat in @(
      @{ k = "memory_rss_bytes"; r = 'process_resident_memory_bytes (\S+)' },
      @{ k = "heap_used_bytes"; r = 'nodejs_heap_used_bytes (\S+)' },
      @{ k = "outbox_pending"; r = 'homigo_outbox_pending (\S+)' },
      @{ k = "outbox_oldest_age_s"; r = 'homigo_outbox_oldest_pending_age_seconds (\S+)' },
      @{ k = "dlq_unresolved"; r = 'homigo_dlq_unresolved (\S+)' },
      @{ k = "db_active"; r = 'db_connections_active (\S+)' },
      @{ k = "db_idle"; r = 'db_connections_idle (\S+)' },
      @{ k = "redis_up"; r = 'redis_up (\S+)' },
      @{ k = "redis_memory_bytes"; r = 'redis_memory_bytes (\S+)' },
      @{ k = "redis_clients"; r = 'redis_connected_clients (\S+)' },
      @{ k = "redis_evicted"; r = 'redis_evicted_keys (\S+)' },
      @{ k = "scheduled_job_lag_s"; r = 'homigo_scheduled_job_lag_seconds (\S+)' }
    )) {
      $m = [regex]::Match($raw, $pat.r)
      if ($m.Success) {
        $v = $m.Groups[1].Value
        $sample[$pat.k] = if ($v -match '^-?\d') { [double]$v } else { $v }
      }
    }
    $rateCmd = "curl -sf 'http://localhost:9090/api/v1/query?query=sum(rate(homigo_consumer_failed_total%5B5m%5D))'"
    $rateRaw = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command=$rateCmd 2>$null
    $rateLine = ($rateRaw | Where-Object { $_ -match '^\{' }) | Select-Object -Last 1
    if ($rateLine) {
      try {
        $rj = $rateLine | ConvertFrom-Json
        if ($rj.data.result.Count -gt 0) { $sample.consumer_failed_rate_5m = [double]$rj.data.result[0].value[1] }
      } catch {}
    }
    return $sample
  } catch {
    $sample.error = $_.Exception.Message
    return $sample
  }
}

Write-Host "STAGE_G_COLLECTOR_START runId=$RunId soakMin=$SoakMinutes intervalSec=$IntervalSec"
while ((Get-Date) -lt $end) {
  $s = Scrape-Metrics
  ($s | ConvertTo-Json -Compress) | Add-Content $samplesFile
  Write-Host "SAMPLE $($s.ts) pending=$($s.outbox_pending) mem=$($s.memory_rss_bytes) dlq=$($s.dlq_unresolved)"
  Start-Sleep -Seconds $IntervalSec
}
Write-Host "STAGE_G_COLLECTOR_COMPLETE file=$samplesFile"
