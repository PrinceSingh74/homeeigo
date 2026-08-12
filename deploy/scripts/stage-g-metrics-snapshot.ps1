# Stage G — Prometheus metrics snapshot helper (queries permanent stack via VM SSH).
param(
  [string]$Label = "snapshot",
  [string]$EvidenceDir = "D:\homigo\docs\evidence\stage-g-soak"
)

$ErrorActionPreference = "Continue"
$PROJECT = "homigo-497619"
$ZONE = "asia-south1-b"
$VM = "homigo-obs-staging"

$queries = @{
  up = 'up{job="homigo-backend-staging"}'
  outbox_pending = "homigo_outbox_pending"
  outbox_oldest_age = "homigo_outbox_oldest_pending_age_seconds"
  dlq_unresolved = "homigo_dlq_unresolved"
  scheduled_job_lag = "homigo_scheduled_job_lag_seconds"
  db_active = "db_connections_active"
  db_idle = "db_connections_idle"
  redis_up = "redis_up"
  redis_memory = "redis_memory_bytes"
  redis_clients = "redis_connected_clients"
  redis_evicted = "redis_evicted_keys"
  memory_rss = "process_resident_memory_bytes"
  consumer_failed_rate = "sum(rate(homigo_consumer_failed_total[5m]))"
  consumer_processed_rate = "sum(rate(homigo_consumer_processed_total[5m]))"
  event_latency_p50 = 'histogram_quantile(0.50, sum(rate(homigo_outbox_processing_duration_seconds_bucket[5m])) by (le))'
  event_latency_p95 = 'histogram_quantile(0.95, sum(rate(homigo_outbox_processing_duration_seconds_bucket[5m])) by (le))'
  event_latency_p99 = 'histogram_quantile(0.99, sum(rate(homigo_outbox_processing_duration_seconds_bucket[5m])) by (le))'
  booking_created_rate = 'sum(rate(homigo_domain_event_total{event_type="booking.created"}[5m]))'
}

function Get-PromValue {
  param([string]$Query)
  $enc = [uri]::EscapeDataString($Query)
  $cmd = "curl -sf 'http://localhost:9090/api/v1/query?query=$enc'"
  $raw = gcloud compute ssh $VM --project=$PROJECT --zone=$ZONE --quiet --command=$cmd 2>&1
  $line = ($raw | Where-Object { $_ -match '^\{' }) | Select-Object -Last 1
  if (-not $line) { return $null }
  try {
    $j = $line | ConvertFrom-Json
    if ($j.data.result.Count -gt 0) { return [double]$j.data.result[0].value[1] }
  } catch {}
  return $null
}

$ts = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$snap = @{ label = $Label; ts = $ts; prometheus = @{} }
foreach ($k in $queries.Keys) {
  $snap.prometheus[$k] = Get-PromValue -Query $queries[$k]
}

# Direct /metrics scrape for health + instance memory if prom missing
$PROJECT_ID = $PROJECT
try {
  $token = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$PROJECT_ID).Trim()
  $health = curl.exe -s "https://homigo-backend-staging-144968192234.asia-south1.run.app/health"
  $snap.api_health = ($health | ConvertFrom-Json)
  $metricsRaw = curl.exe -s -H "Authorization: Bearer $token" "https://homigo-backend-staging-144968192234.asia-south1.run.app/metrics"
  foreach ($pat in @(
    @{ k = "metrics_memory_rss"; r = 'process_resident_memory_bytes (\d+)' },
    @{ k = "metrics_outbox_pending"; r = 'homigo_outbox_pending (\d+)' },
    @{ k = "metrics_dlq"; r = 'homigo_dlq_unresolved (\d+)' },
    @{ k = "metrics_oldest_age"; r = 'homigo_outbox_oldest_pending_age_seconds (\d+)' }
  )) {
    $m = [regex]::Match($metricsRaw, $pat.r)
    if ($m.Success) { $snap[$pat.k] = [double]$m.Groups[1].Value }
  }
} catch {
  $snap.metrics_scrape_error = $_.Exception.Message
}

$outFile = Join-Path $EvidenceDir "stage-g-snapshot-$Label.json"
$snap | ConvertTo-Json -Depth 6 | Set-Content $outFile
Write-Output ($snap | ConvertTo-Json -Compress -Depth 6)
