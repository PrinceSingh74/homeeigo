# Serial backend section regression - one bun process per file (Windows Bun stability)
Set-Alias -Name bun -Value "$env:USERPROFILE\.bun\bin\bun.exe" -Scope Script
$files = @(
  # Section 01
  "src/__tests__/partner-acquisition.test.ts",
  "src/__tests__/partner-acquisition-automation.test.ts",
  "src/__tests__/partner-acquisition-p1p2.integration.test.ts",
  "src/__tests__/partner-lifecycle-fsm.test.ts",
  # Section 02
  "src/__tests__/partner-availability-fsm.test.ts",
  "src/__tests__/partner-operations.integration.test.ts",
  "src/__tests__/assignment-dispatch-lock.test.ts",
  # Section 03
  "src/__tests__/section03-job-action-policy.test.ts",
  "src/__tests__/section03-job-proximity.test.ts",
  # Section 04
  "src/__tests__/section04-withdraw.integration.test.ts",
  "src/__tests__/section04-incentive.integration.test.ts",
  "src/__tests__/partner-incentive-payout.test.ts",
  # Section 05
  "src/__tests__/section05-trust.integration.test.ts",
  "src/__tests__/section05-trust-pure.test.ts",
  # Section 06
  "src/__tests__/partner-score-policy.test.ts",
  "src/__tests__/partner-career-policy.test.ts",
  # Section 07
  "src/__tests__/section07-referral.integration.test.ts",
  "src/__tests__/partner-referral-fsm.test.ts",
  # Section 08
  "src/__tests__/section08-ai-governance.test.ts",
  "src/__tests__/zone-scoring.test.ts",
  # Section 09
  "src/__tests__/section09-events-automation.integration.test.ts",
  "src/__tests__/section09-closure.integration.test.ts",
  "src/events/__tests__/event-failure-scenarios.test.ts",
  # Section 10 + realtime
  "src/__tests__/section10-request-context.test.ts",
  "src/__tests__/ws-channel-access.test.ts"
)

$results = @()
foreach ($f in $files) {
  Write-Host "=== RUNNING $f ==="
  $out = & bun test $f 2>&1 | Out-String
  $code = $LASTEXITCODE
  $summary = ($out -split "`n" | Where-Object { $_ -match "^\s*\d+ (pass|fail)|Ran \d+ tests" }) -join " | "
  $status = if ($code -eq 0) { "PASS" } else { "FAIL($code)" }
  $line = "$status  $f  $summary"
  $results += $line
  Write-Host $line
  if ($code -ne 0) {
    Write-Host "----- FAILURE OUTPUT (tail) -----"
    Write-Host (($out -split "`n" | Select-Object -Last 40) -join "`n")
    Write-Host "----- END FAILURE OUTPUT -----"
  }
}
Write-Host ""
Write-Host "############ BACKEND REGRESSION SUMMARY ############"
$results | ForEach-Object { Write-Host $_ }
Write-Host "############ DONE ############"
