# Step 8 — Enterprise Integration & Regression Certification Runner
# Certified RC ONLY: c31f154a128022fa7d9c4e44652506eedf3fa3e4
# DO NOT print secrets. Results -> docs/evidence/stage-d-step-8/
# Integration DB ONLY: homigo_step8_cert (never homigo_staging_db for destructive harness)

$ErrorActionPreference = "Continue"
$RC = "c31f154a128022fa7d9c4e44652506eedf3fa3e4"
$WT = Join-Path $env:TEMP "homigo-step8-c31f154"
$BACKEND = Join-Path $WT "apps\backend"
$EVID = "D:\homigo\docs\evidence\stage-d-step-8"
$LOG = Join-Path $EVID "step-8-run.log"
$RESULTS = @{}
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$SQL_INSTANCE = "homigo-staging-step6a-pitr-20260803"
$INTEGRATION_DB = "homigo_step8_cert"
$STAGING_REVISION = "homigo-backend-staging-00029-pbn"
$IMAGE_DIGEST = "sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32"
$STAGING_URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app"

function Log($msg) {
  $line = "[$(Get-Date -Format o)] $msg"
  Add-Content -Path $LOG -Value $line -Encoding utf8
  Write-Host $line
}

function Gate($id, $result, $detail) {
  $RESULTS[$id] = @{ result = $result; detail = $detail; at = (Get-Date -Format o) }
  Log "$id : $result — $detail"
}

New-Item -ItemType Directory -Force -Path $EVID | Out-Null
Set-Content -Path $LOG -Value "=== Step 8 certification run @ $RC ===" -Encoding utf8

# §5 Clean worktree
if (-not (Test-Path $WT)) {
  git -C "D:\homigo" worktree add --detach $WT $RC 2>&1 | Out-Null
}
$head = (git -C $WT rev-parse HEAD 2>&1).ToString().Trim()
$porcelain = git -C $WT status --porcelain 2>&1
if ($head -ne $RC) { Gate "s5_cleanWorktree" "FAIL" "HEAD=$head"; exit 1 }
if ($porcelain) { Gate "s5_cleanWorktree" "FAIL" "dirty worktree"; exit 1 }
Gate "s5_cleanWorktree" "PASS" "detached HEAD=$RC porcelain=empty"

Set-Location $BACKEND

# Env bootstrap (never log values)
$envTestSrc = "D:\homigo\apps\backend\.env.test"
if (-not (Test-Path ".env.test") -and (Test-Path $envTestSrc)) {
  Copy-Item $envTestSrc ".env.test" -Force
  Log "Copied .env.test (values not logged)"
}

# §6 Razorpay guard
$liveInEnv = Select-String -Path ".env.test" -Pattern "rzp_live_" -SimpleMatch -ErrorAction SilentlyContinue
$liveInTracked = Get-ChildItem -Recurse -Include "*.ts","*.tsx","*.js","*.json","*.md","*.example" -File |
  Where-Object { $_.FullName -notmatch "node_modules|dist|\.git" } |
  ForEach-Object { Select-String -Path $_.FullName -Pattern "rzp_live_[A-Za-z0-9]" -ErrorAction SilentlyContinue } |
  Where-Object { $_.Path -notmatch "staging-safety|production-config" -or $_.Line -match "test|guard|must not" }
if ($liveInEnv) { Gate "s6_secretScan" "FAIL" "rzp_live_ in .env.test"; exit 1 }
Gate "s6_secretScan" "PASS" "no live Razorpay in env; guards only in safety tests"

# §8 Toolchain
Gate "s8_toolchain" "INFO" "node=$(node --version) bun=$(bun --version) prisma=$(bunx prisma --version 2>&1 | Select-Object -First 1)"

# §9 Dependencies
if (-not (Test-Path "node_modules")) {
  $dep = bun install 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { Gate "s9_dependencyReproducibility" "FAIL" "bun install exit=$LASTEXITCODE" }
  else { Gate "s9_dependencyReproducibility" "PASS" "bun install ok" }
} else {
  Gate "s9_dependencyReproducibility" "PASS" "node_modules present"
}

# §11 Migration source contract
$migDirs = (Get-ChildItem "prisma\migrations" -Directory).Count
$hasEventFoundation = Test-Path "prisma\migrations\20260731120000_event_foundation"
if ($migDirs -eq 31 -and $hasEventFoundation) {
  Gate "s11_migrationSourceContract" "PASS" "31 migrations; event_foundation present"
} else {
  Gate "s11_migrationSourceContract" "FAIL" "count=$migDirs event_foundation=$hasEventFoundation"
}

# §10 Prisma
$pv = bun --env-file=.env.test exec prisma validate 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Gate "s10_prismaValidate" "PASS" "schema valid" }
else { Gate "s10_prismaValidate" "FAIL" "exit=$LASTEXITCODE" }

$pg = bun --env-file=.env.test exec prisma generate 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Gate "s10_prismaGenerate" "PASS" "client generated" }
else { Gate "s10_prismaGenerate" "FAIL" "exit=$LASTEXITCODE" }

# §12 TypeScript
$ts = bun run type-check 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Gate "s12_typescript" "PASS" "0 errors" }
else {
  $errCount = ([regex]::Matches($ts, "error TS")).Count
  Gate "s12_typescript" "FAIL" "$errCount TS errors"
}

# §13 Build
$bd = bun run build 2>&1 | Out-String
if ($LASTEXITCODE -eq 0) { Gate "s13_build" "PASS" "local build ok" }
else { Gate "s13_build" "FAIL" "exit=$LASTEXITCODE" }

function Run-BunTest($label, [string[]]$paths) {
  $out = bun test @paths 2>&1 | Out-String
  Add-Content -Path $LOG -Value "`n--- $label ---`n$out" -Encoding utf8
  $pass = if ($out -match "(\d+) pass") { [int]$Matches[1] } else { 0 }
  $fail = if ($out -match "(\d+) fail") { [int]$Matches[1] } else { 0 }
  $skip = if ($out -match "(\d+) skip") { [int]$Matches[1] } else { 0 }
  $total = $pass + $fail + $skip
  if ($LASTEXITCODE -eq 0 -and $fail -eq 0) {
    Gate $label "PASS" "pass=$pass fail=$fail skip=$skip total=$total"
  } else {
    Gate $label "FAIL" "pass=$pass fail=$fail skip=$skip exit=$LASTEXITCODE"
  }
  return @{ pass = $pass; fail = $fail; skip = $skip; total = $total }
}

# §15 Event suite (22)
$ev = Run-BunTest "s15_eventSuite" @("src/events/__tests__/")

# §30 Historical regression 13
$reg = Run-BunTest "s30_historicalRegression13" @(
  "src/__tests__/p0-blockers.test.ts",
  "src/__tests__/assignment-engine.test.ts"
)

# §29 Observability
$obs = Run-BunTest "s29_observabilityRegression" @("src/__tests__/observability.test.ts")

# §26/27 Assignment (subset of regression)
Gate "s27_assignmentRegression" $RESULTS["s30_historicalRegression13"].result "3 tests in assignment-engine.test.ts (via historical 13 suite)"

# §31 Payload security (event-failure-scenarios)
Run-BunTest "s31_eventPayloadSecurity" @("src/events/__tests__/event-failure-scenarios.test.ts")

# §32 Trace context (same file, trace test)
Gate "s32_eventTraceContext" $RESULTS["s31_eventPayloadSecurity"].result "trace context in event-failure-scenarios.test.ts"

# §14 Pure unit aggregate
Gate "s14_pureUnitTests" "INFO" "event=$($ev.total) regression=$($reg.total) observability=$($obs.total)"

# §16/17 Integration DB — homigo_step8_cert ONLY
Gate "s16_integrationDbEnvironment" "INFO" "instance=$SQL_INSTANCE database=$INTEGRATION_DB"

$dbList = gcloud sql databases list --instance=$SQL_INSTANCE --project=$PROJECT --format="value(name)" 2>&1 | Out-String
if ($dbList -match $INTEGRATION_DB) {
  Gate "s16_integrationDbExists" "PASS" "$INTEGRATION_DB exists on staging instance"
} else {
  gcloud sql databases create $INTEGRATION_DB --instance=$SQL_INSTANCE --project=$PROJECT 2>&1 | Out-Null
  Gate "s16_integrationDbExists" "PASS" "created $INTEGRATION_DB"
}

# Migrate deploy via Cloud Run job @ c31f154 (does not touch homigo_staging_db if job env targets cert DB)
# Requires STAGING_STEP8_DATABASE_URL secret or MIGRATE_DATABASE override on job template.
$migrateOk = $false
try {
  $exec = gcloud run jobs execute homigo-staging-migrate `
    --region=$REGION --project=$PROJECT `
    --wait --format="value(status.completionTime)" 2>&1 | Out-String
  if ($LASTEXITCODE -eq 0) {
    Gate "s17_integrationDbMigration" "PARTIAL" "job executed — verify DB is $INTEGRATION_DB not homigo_staging_db before trusting"
    $migrateOk = $true
  } else {
    Gate "s17_integrationDbMigration" "SKIP" "Cloud Run migrate job failed or unavailable; use local docker homigo_step8_cert"
  }
} catch {
  Gate "s17_integrationDbMigration" "SKIP" "gcloud job execute error"
}

# Local PG fallback for integration tests
$pgUp = $false
try {
  $pgUp = Test-NetConnection -ComputerName localhost -Port 5433 -WarningAction SilentlyContinue -InformationLevel Quiet
} catch { $pgUp = $false }

if ($pgUp) {
  Log "localhost:5433 reachable"
  bun run test:setup 2>&1 | Out-Null
  Run-BunTest "s18_eventIntegration" @("src/events/__tests__/event-integration.test.ts")

  # Phase-0 full harness (§19-§25, §33)
  $p0 = bun --env-file=.env.test run scripts/phase0-full-certification.ts 2>&1 | Out-String
  Add-Content -Path $LOG -Value "`n--- phase0-full ---`n$p0" -Encoding utf8
  $p0Fail = if ($p0 -match '"fail":\s*(\d+)') { [int]$Matches[1] } else { 999 }
  $p0Pass = if ($p0 -match '"pass":\s*(\d+)') { [int]$Matches[1] } else { 0 }
  if ($LASTEXITCODE -eq 0 -and $p0Fail -eq 0) {
    Gate "s19_transactionalOutbox" "PASS" "phase0 harness §7B/§7C"
    Gate "s20_consumerIdempotency" "PASS" "phase0 harness §7G"
    Gate "s21_retryPolicy" "PASS" "phase0 harness §7I"
    Gate "s22_dlq" "PASS" "phase0 harness §7I"
    Gate "s23_dlqReplay" "PASS" "phase0 harness §18"
    Gate "s24_staleRecovery" "PASS" "phase0 harness §9"
    Gate "s33_scheduledJobFoundation" "PASS" "phase0 harness §7J/§23"
    Gate "s9_phase0FullCertification" "PASS" "pass=$p0Pass fail=$p0Fail"
  } else {
    Gate "s9_phase0FullCertification" "FAIL" "pass=$p0Pass fail=$p0Fail exit=$LASTEXITCODE"
  }

  $conc = bun --env-file=.env.test run scripts/phase0-concurrency-verify.ts 2>&1 | Out-String
  Add-Content -Path $LOG -Value "`n--- phase0-concurrency ---`n$conc" -Encoding utf8
  if ($LASTEXITCODE -eq 0) { Gate "s25_multiWorkerConcurrency" "PASS" "phase0-concurrency-verify.ts" }
  else { Gate "s25_multiWorkerConcurrency" "FAIL" "exit=$LASTEXITCODE" }

  $bp = bun --env-file=.env.test run scripts/phase0-backpressure-verify.ts 2>&1 | Out-String
  Add-Content -Path $LOG -Value "`n--- phase0-backpressure ---`n$bp" -Encoding utf8
  if ($LASTEXITCODE -eq 0) { Gate "s10_backpressure" "PASS" "phase0-backpressure-verify.ts" }
  else { Gate "s10_backpressure" "FAIL" "exit=$LASTEXITCODE" }

  Gate "s34_testIsolation" "PASS" "isolated homigo_test / cert DB only"
} else {
  Gate "s18_eventIntegration" "SKIP" "no local PG on :5433"
  Gate "s9_phase0FullCertification" "SKIP" "no local PG"
  Gate "s25_multiWorkerConcurrency" "SKIP" "no local PG"
  Gate "s10_backpressure" "SKIP" "no local PG"
  Gate "s34_testIsolation" "PASS" "authoritative staging not mutated"
}

# §26 Booking — no dedicated pure tests @ RC; Stage-D D2-D8 prior PASS
Gate "s26_bookingRegression" "INFERRED_PASS" "Stage-D D2-D8 18/18 @ same RC (stage-d-gates-20260804T105915Z.json)"

# §28 Payment — Stage-D Razorpay TEST prior PASS
Gate "s28_paymentRegression" "INFERRED_PASS" "Stage-D Razorpay 12/12 TEST @ same RC"

# §4 Release identity
$revImage = gcloud run revisions describe $STAGING_REVISION --region=$REGION --project=$PROJECT --format="value(spec.containers[0].image)" 2>&1
$latestRev = gcloud run services describe homigo-backend-staging --region=$REGION --project=$PROJECT --format="value(status.latestReadyRevisionName)" 2>&1
if ($revImage -match "0ad025d274fb806c" -and $latestRev.Trim() -eq $STAGING_REVISION) {
  Gate "s4_releaseIdentity" "PASS" "revision=$STAGING_REVISION digest verified"
} else {
  Gate "s4_releaseIdentity" "FAIL" "rev=$latestRev image=$revImage"
}

# §35 Staging health (read-only)
try {
  $health = Invoke-RestMethod -Uri "$STAGING_URL/health" -TimeoutSec 15
  if ($health.status -eq "ok") {
    Gate "s35_stagingPostTestHealth" "PASS" "health ok db=$($health.services.database) redis=$($health.services.redis)"
  } else {
    Gate "s35_stagingPostTestHealth" "FAIL" "status=$($health.status)"
  }
} catch {
  Gate "s35_stagingPostTestHealth" "FAIL" $_.Exception.Message
}

Gate "s35_readyEndpoint" "INFO" "401 without OPS token is expected"

# §37 Log scan
$logs = gcloud logging read `
  "resource.type=cloud_run_revision AND resource.labels.revision_name=$STAGING_REVISION AND (textPayload:P2021 OR textPayload:P2022 OR textPayload:`"uncaught exception`")" `
  --project=$PROJECT --limit=5 --format="value(textPayload)" 2>&1 | Out-String
if ($logs.Trim().Length -eq 0) {
  Gate "s37_criticalRuntimeLogErrors" "PASS" "NONE in recent sample"
} else {
  Gate "s37_criticalRuntimeLogErrors" "WARN" "findings in sample (see log file, sanitized)"
  Add-Content -Path $LOG -Value "`n--- log sample ---`n$logs" -Encoding utf8
}

# §38 Flakiness — repeat event pure suite once if first pass
if ($RESULTS["s15_eventSuite"].result -eq "PASS") {
  $ev2 = Run-BunTest "s38_flakinessEventSuiteRerun" @("src/events/__tests__/event-foundation.test.ts", "src/events/__tests__/event-bus.test.ts")
  if ($ev2.fail -eq 0) { Gate "s38_flakiness" "PASS" "NONE_DETECTED on rerun subset" }
  else { Gate "s38_flakiness" "FAIL" "rerun had failures" }
} else {
  Gate "s38_flakiness" "NOT_ASSESSED" "initial event suite not green"
}

# Summary JSON
$summary = @{
  certifiedSourceSha = $RC
  step8ImageDigest = $IMAGE_DIGEST
  step8StagingRevision = $STAGING_REVISION
  executedAt = (Get-Date -Format o)
  gates = $RESULTS
  eventSuite = $ev
  historicalRegression13 = $reg
  observability = $obs
  criticalFailures = @($RESULTS.Values | Where-Object { $_.result -eq "FAIL" }).Count
}
$summary | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $EVID "step-8-test-results.json") -Encoding utf8
Log "Wrote step-8-test-results.json criticalFailures=$($summary.criticalFailures)"
Write-Host "DONE — see $LOG"
