# Serial Section 01-09 + P0/P1/P2 regression. Reuses running servers.
$ErrorActionPreference = "Continue"
$env:E2E_SKIP_SERVERS = "1"
$root = "D:\homigo"
$log = Join-Path $root "apps\backend\scripts\section09-regression-log.json"
$results = @()

function Run-Step($name, $cwd, $cmd) {
  Write-Host "`n==== $name ====" -ForegroundColor Cyan
  Push-Location $cwd
  cmd /c $cmd
  $code = $LASTEXITCODE
  Pop-Location
  $status = if ($code -eq 0) { "PASS" } else { "FAIL" }
  $script:results += [pscustomobject]@{ name = $name; status = $status; exit = $code }
  Write-Host "$status $name exit=$code" -ForegroundColor $(if ($code -eq 0) { "Green" } else { "Red" })
}

# Backend integration — one file at a time (Bun 1.3.14 Windows segfaults on multi-file)
$be = Join-Path $root "apps\backend"
Run-Step "be.section03-job-action" $be "bun test src/__tests__/section03-job-action-policy.test.ts"
Run-Step "be.section03-proximity" $be "bun test src/__tests__/section03-job-proximity.test.ts"
Run-Step "be.section04-incentive" $be "bun test src/__tests__/section04-incentive.integration.test.ts"
Run-Step "be.section04-withdraw" $be "bun test src/__tests__/section04-withdraw.integration.test.ts"
Run-Step "be.section05-trust-pure" $be "bun test src/__tests__/section05-trust-pure.test.ts"
Run-Step "be.section05-trust-int" $be "bun test src/__tests__/section05-trust.integration.test.ts"
Run-Step "be.section07-referral" $be "bun test src/__tests__/section07-referral.integration.test.ts"
Run-Step "be.section08-ai" $be "bun test src/__tests__/section08-ai-governance.test.ts"
Run-Step "be.section09-closure" $be "bun test src/__tests__/section09-closure.integration.test.ts"
Run-Step "be.section09-events" $be "bun test src/__tests__/section09-events-automation.integration.test.ts"

$pw = Join-Path $root "apps\partner-web"
Run-Step "pw.section03-lifecycle" $pw "npx playwright test e2e/section03-lifecycle-api.spec.ts --reporter=list"
Run-Step "pw.section03-job" $pw "npx playwright test e2e/section03-job-execution.spec.ts --reporter=list"
Run-Step "pw.section03-live" $pw "npx playwright test e2e/section03-live-job-execution.spec.ts --reporter=list"
Run-Step "pw.section03-a11y" $pw "npx playwright test e2e/section03-a11y-responsive.spec.ts --reporter=list"
Run-Step "pw.section04-finance" $pw "npx playwright test e2e/section04-finance.spec.ts --reporter=list"
Run-Step "pw.section04-a11y" $pw "npx playwright test e2e/section04-a11y-responsive.spec.ts --reporter=list"
Run-Step "pw.section05-trust" $pw "npx playwright test e2e/section05-trust.spec.ts --reporter=list"
Run-Step "pw.section05-a11y" $pw "npx playwright test e2e/section05-a11y-responsive.spec.ts --reporter=list"
Run-Step "pw.section06" $pw "npx playwright test e2e/section06-score-career.spec.ts --reporter=list"
Run-Step "pw.section07" $pw "npx playwright test e2e/section07-referral.spec.ts --reporter=list"
Run-Step "pw.section08" $pw "npx playwright test e2e/section08-ai.spec.ts --reporter=list"
Run-Step "pw.section09" $pw "npx playwright test e2e/section09-notifications.spec.ts --reporter=list"
Run-Step "pw.p0-onboarding" $pw "npx playwright test e2e/p0-partner-onboarding.spec.ts --reporter=list"
Run-Step "pw.p0-a11y" $pw "npx playwright test e2e/p0-a11y.spec.ts --reporter=list"
Run-Step "pw.p2-availability" $pw "npx playwright test e2e/p2-availability.spec.ts --reporter=list"

$ad = Join-Path $root "apps\admin-panel"
Run-Step "ad.section04" $ad "npx playwright test e2e/section04-finance.spec.ts --reporter=list"
Run-Step "ad.section05" $ad "npx playwright test e2e/section05-trust.spec.ts --reporter=list"
Run-Step "ad.section07" $ad "npx playwright test e2e/section07-referral.spec.ts --reporter=list"
Run-Step "ad.section09" $ad "npx playwright test e2e/section09-automation.spec.ts --reporter=list"
Run-Step "ad.p0-a11y" $ad "npx playwright test e2e/p0-a11y.spec.ts --reporter=list"
Run-Step "ad.p0-start" $ad "npx playwright test e2e/p0-start-application.spec.ts --reporter=list"
Run-Step "ad.p1-ia" $ad "npx playwright test e2e/p1-acquisition-ia.spec.ts --reporter=list"
Run-Step "ad.p1-visual" $ad "npx playwright test e2e/p1-visual-matrix.spec.ts --reporter=list"
Run-Step "ad.p1-visual-remaining" $ad "npx playwright test e2e/p1-visual-matrix-remaining.spec.ts --reporter=list"
Run-Step "ad.p2-availability" $ad "npx playwright test e2e/p2-partner-availability.spec.ts --reporter=list"
Run-Step "ad.p2-orphaned" $ad "npx playwright test e2e/p2-1-orphaned-pages.spec.ts --reporter=list"

$web = Join-Path $root "apps\web"
Run-Step "web.section04" $web "npx playwright test e2e/section04-customer-finance.spec.ts --reporter=list"
Run-Step "web.section05" $web "npx playwright test e2e/section05-customer-privacy.spec.ts --reporter=list"
Run-Step "web.section09" $web "npx playwright test e2e/section09-customer-notifications.spec.ts --reporter=list"

$results | ConvertTo-Json -Depth 4 | Set-Content $log
$fail = @($results | Where-Object { $_.status -eq "FAIL" }).Count
$pass = @($results | Where-Object { $_.status -eq "PASS" }).Count
Write-Host "`nREGRESSION $pass PASS / $fail FAIL / $($results.Count) total" -ForegroundColor Yellow
exit $(if ($fail -gt 0) { 1 } else { 0 })
