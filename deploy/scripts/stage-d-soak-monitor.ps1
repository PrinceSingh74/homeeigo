# Stage D soak — poll /metrics every 5 min for 30 min
param([int]$Minutes = 30, [int]$IntervalSec = 300)
$PROJECT = "homigo-497619"
$URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app/metrics"
$token = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$PROJECT).Trim()
$samples = @()
$end = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $end) {
  $ts = (Get-Date).ToUniversalTime().ToString("o")
  $raw = curl.exe -s -H "Authorization: Bearer $token" $URL
  $m1 = [regex]::Match($raw, 'homigo_outbox_pending (\d+)')
  $m2 = [regex]::Match($raw, 'homigo_dlq_unresolved (\d+)')
  $m3 = [regex]::Match($raw, 'homigo_outbox_oldest_pending_age_seconds (\d+)')
  $outbox = if ($m1.Success) { $m1.Groups[1].Value } else { "?" }
  $dlq = if ($m2.Success) { $m2.Groups[1].Value } else { "?" }
  $age = if ($m3.Success) { $m3.Groups[1].Value } else { "?" }
  $sample = [pscustomobject]@{ ts = $ts; outbox_pending = $outbox; dlq_unresolved = $dlq; oldest_pending_age_s = $age }
  $samples += $sample
  Write-Output ($sample | ConvertTo-Json -Compress)
  Start-Sleep -Seconds $IntervalSec
}
$outPath = "D:\homigo\docs\evidence\stage-d\stage-d-soak-$(Get-Date -Format 'yyyyMMddTHHmmss').json"
$samples | ConvertTo-Json | Set-Content $outPath
Write-Output "SOAK_COMPLETE path=$outPath"
