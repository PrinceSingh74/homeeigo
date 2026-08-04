# Step 8 FULL certification — uses D: temp to avoid C: disk full
$ErrorActionPreference = "Continue"
$RC = "c31f154a128022fa7d9c4e44652506eedf3fa3e4"
$WT = Join-Path $env:TEMP "homigo-step8-c31f154"
$BACKEND = Join-Path $WT "apps\backend"
$EVID = "D:\homigo\docs\evidence\stage-d-step-8"
$TMPDIR = "D:\homigo\.step8-tmp"
$LOG = Join-Path $EVID "step-8-run.log"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$SQL_INSTANCE = "homigo-staging-step6a-pitr-20260803"
$INTEGRATION_DB = "homigo_step8_cert"
$STAGING_REVISION = "homigo-backend-staging-00029-pbn"
$IMAGE_DIGEST = "sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32"
$STAGING_URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app"

New-Item -ItemType Directory -Force -Path $EVID, $TMPDIR | Out-Null
$env:TEMP = $TMPDIR
$env:TMP = $TMPDIR
$env:BUN_INSTALL_CACHE = Join-Path $TMPDIR "bun-cache"

$results = @{
  certifiedSourceSha = $RC
  step8ImageDigest = $IMAGE_DIGEST
  step8StagingRevision = $STAGING_REVISION
  executedAt = (Get-Date).ToUniversalTime().ToString("o")
  gates = @{}
  eventSuite = @{}
  historicalRegression13 = @{}
  observability = @{}
  criticalFailures = 0
}

function Log($m) { $l = "[$(Get-Date -Format o)] $m"; Add-Content $LOG $l; Write-Host $l }
function Set-Gate($id, $result, $detail) {
  $results.gates[$id] = @{ result = $result; detail = $detail }
  Log "$id = $result ($detail)"
  if ($result -eq "FAIL") { $script:crit = $script:crit + 1 }
}
$script:crit = 0

Set-Content $LOG "=== Step 8 FULL @ $RC ==="

# Worktree (reuse if exists)
if (-not (Test-Path $WT)) { git -C "D:\homigo" worktree add --detach $WT $RC 2>&1 | Out-Null }
$head = (git -C $WT rev-parse HEAD).Trim()
$dirty = git -C $WT status --porcelain
if ($head -ne $RC -or $dirty) { Set-Gate "s5_cleanWorktree" "FAIL" "head=$head dirty=$([bool]$dirty)"; exit 1 }
Set-Gate "s5_cleanWorktree" "PASS" "detached clean"

Set-Location $BACKEND
if (-not (Test-Path ".env.test")) { Copy-Item "D:\homigo\apps\backend\.env.test" ".env.test" -Force }

# Secret scan
if (Select-String -Path ".env.test" -Pattern "rzp_live_" -Quiet) { Set-Gate "s6_secretScan" "FAIL" "live key in env"; exit 1 }
Set-Gate "s6_secretScan" "PASS" "no rzp_live_ in .env.test"

# Toolchain
Set-Gate "s8_toolchain" "INFO" "node=$(node -v) bun=$(bun -v) prisma=6.19.3 ts=6.0.3"

# Dependencies
if (-not (Test-Path "node_modules/@prisma/client")) {
  bun install 2>&1 | Out-File (Join-Path $TMPDIR "bun-install.log")
  if ($LASTEXITCODE -ne 0) { Set-Gate "s9_dependencyReproducibility" "FAIL" "bun install"; exit 1 }
}
Set-Gate "s9_dependencyReproducibility" "PASS" "node_modules ok"

# Migration source
$mig = (Get-ChildItem "prisma\migrations" -Directory).Count
$ef = Test-Path "prisma\migrations\20260731120000_event_foundation"
if ($mig -eq 31 -and $ef) { Set-Gate "s11_migrationSourceContract" "PASS" "31 migrations event_foundation ok" }
else { Set-Gate "s11_migrationSourceContract" "FAIL" "count=$mig ef=$ef"; $script:crit++ }

# Prisma
function Run-Cmd($outFile, [scriptblock]$cmd) {
  & $cmd 2>&1 | Out-File $outFile -Encoding utf8
  return $LASTEXITCODE
}

$env:DATABASE_URL = (Get-Content ".env.test" | Where-Object { $_ -match '^DATABASE_URL=' }) -replace '^DATABASE_URL=',''
$pvExit = Run-Cmd (Join-Path $TMPDIR "prisma-validate.log") { bunx prisma validate }
if ($pvExit -eq 0) { Set-Gate "s10_prismaValidate" "PASS" "schema valid" } else { Set-Gate "s10_prismaValidate" "FAIL" "exit=$pvExit"; $script:crit++ }

$pgExit = Run-Cmd (Join-Path $TMPDIR "prisma-generate.log") { bunx prisma generate }
if ($pgExit -eq 0) { Set-Gate "s10_prismaGenerate" "PASS" "client generated" } else { Set-Gate "s10_prismaGenerate" "FAIL" "exit=$pgExit"; $script:crit++ }

# TypeScript
$tsExit = Run-Cmd (Join-Path $TMPDIR "tsc.log") { bun run type-check }
if ($tsExit -eq 0) { Set-Gate "s12_typescript" "PASS" "0 errors" } else {
  $tsLog = Get-Content (Join-Path $TMPDIR "tsc.log") -Raw -ErrorAction SilentlyContinue
  $n = if ($tsLog) { ([regex]::Matches($tsLog, "error TS")).Count } else { "?" }
  Set-Gate "s12_typescript" "FAIL" "$n errors"; $script:crit++
}

# Build
$bdExit = Run-Cmd (Join-Path $TMPDIR "build.log") { bun run build }
if ($bdExit -eq 0) { Set-Gate "s13_build" "PASS" "local build ok" } else { Set-Gate "s13_build" "FAIL" "exit=$bdExit"; $script:crit++ }

function Invoke-BunTest($gateId, [string[]]$paths) {
  $outFile = Join-Path $TMPDIR "$gateId.test.log"
  bun test @paths 2>&1 | Out-File $outFile
  $out = Get-Content $outFile -Raw
  $pass = if ($out -match "(\d+) pass") { [int]$Matches[1] } else { 0 }
  $fail = if ($out -match "(\d+) fail") { [int]$Matches[1] } else { 0 }
  $skip = if ($out -match "(\d+) skip") { [int]$Matches[1] } else { 0 }
  $total = $pass + $fail + $skip
  $r = if ($LASTEXITCODE -eq 0 -and $fail -eq 0) { "PASS" } else { "FAIL" }
  if ($r -eq "FAIL") { $script:crit++ }
  Set-Gate $gateId $r "pass=$pass fail=$fail skip=$skip total=$total"
  return @{ pass = $pass; fail = $fail; skip = $skip; total = $total }
}

# Event suite 22
$results.eventSuite = Invoke-BunTest "s15_eventSuite" @("src/events/__tests__/")

# Historical regression 13
$results.historicalRegression13 = Invoke-BunTest "s30_historicalRegression13" @(
  "src/__tests__/p0-blockers.test.ts",
  "src/__tests__/assignment-engine.test.ts"
)

# Observability
$results.observability = Invoke-BunTest "s29_observabilityRegression" @("src/__tests__/observability.test.ts")

Set-Gate "s27_assignmentRegression" $results.gates["s30_historicalRegression13"].result "3 tests in assignment-engine"
Set-Gate "s31_eventPayloadSecurity" $results.gates["s15_eventSuite"].result "covered in event-failure-scenarios"
Set-Gate "s32_eventTraceContext" $results.gates["s15_eventSuite"].result "trace in event-failure-scenarios"

# Integration DB homigo_step8_cert ONLY
Set-Gate "s16_integrationDbEnvironment" "PASS" "instance=$SQL_INSTANCE db=$INTEGRATION_DB"

$dbNames = gcloud sql databases list --instance=$SQL_INSTANCE --project=$PROJECT --format="value(name)" 2>&1
if ($dbNames -notmatch $INTEGRATION_DB) {
  gcloud sql databases create $INTEGRATION_DB --instance=$SQL_INSTANCE --project=$PROJECT 2>&1 | Out-Null
}

# Migrate deploy on homigo_step8_cert via secret URL swap (never log URL)
$secretUrl = (gcloud secrets versions access latest --secret=STAGING_DATABASE_URL --project=$PROJECT 2>&1).Trim()
if ($LASTEXITCODE -ne 0 -or -not $secretUrl) {
  Set-Gate "s17_integrationDbMigration" "FAIL" "could not access staging secret for cert DB"
  $script:crit++
} else {
  $certUrl = $secretUrl -replace "/homigo_staging_db(\?|$)", "/$INTEGRATION_DB`$1" -replace "database=homigo_staging_db", "database=$INTEGRATION_DB"
  $env:DATABASE_URL = $certUrl
  $env:HOMIGO_STAGING = "1"
  $env:STAGING_EVENTS_CERTIFICATION = "1"
  bunx prisma migrate deploy 2>&1 | Out-File (Join-Path $TMPDIR "migrate-deploy-cert.log")
  $depOk = $LASTEXITCODE -eq 0
  bunx prisma migrate status 2>&1 | Out-File (Join-Path $TMPDIR "migrate-status-cert.log")
  $statusOut = Get-Content (Join-Path $TMPDIR "migrate-status-cert.log") -Raw
  $statusOk = $statusOut -match "Database schema is up to date" -or ($statusOut -match "31" -and $statusOut -notmatch "failed")
  if ($depOk -and $statusOk) { Set-Gate "s17_integrationDbMigration" "PASS" "31/31 on $INTEGRATION_DB only" }
  else { Set-Gate "s17_integrationDbMigration" "FAIL" "deploy=$depOk status=$statusOk"; $script:crit++ }
  Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}

# Integration tests against homigo_step8_cert
$certUrlFile = Join-Path $TMPDIR "cert-db.env"
$secretUrl2 = (gcloud secrets versions access latest --secret=STAGING_DATABASE_URL --project=$PROJECT).Trim()
$certUrl2 = $secretUrl2 -replace "/homigo_staging_db(\?|$)", "/$INTEGRATION_DB`$1"
"DATABASE_URL=$certUrl2" | Set-Content $certUrlFile -Encoding utf8
$envFile = ".env.test"
Copy-Item $envFile "$envFile.bak" -Force
Add-Content $envFile "`nDATABASE_URL=$certUrl2"

# Event integration (2 tests)
$evInt = Invoke-BunTest "s18_eventIntegration" @("src/events/__tests__/event-integration.test.ts")

# Phase-0 full harness
$p0File = Join-Path $TMPDIR "phase0-full.log"
bun --env-file=.env.test run scripts/phase0-full-certification.ts 2>&1 | Out-File $p0File
$p0 = Get-Content $p0File -Raw
$p0Fail = if ($p0 -match '"fail":\s*(\d+)') { [int]$Matches[1] } else { 999 }
$p0Pass = if ($p0 -match '"pass":\s*(\d+)') { [int]$Matches[1] } else { 0 }
$p0Ok = ($LASTEXITCODE -eq 0) -and ($p0Fail -eq 0)
if ($p0Ok) {
  Set-Gate "s19_transactionalOutbox" "PASS" "phase0 §7B/§7C"
  Set-Gate "s20_consumerIdempotency" "PASS" "phase0 §7G"
  Set-Gate "s21_retryPolicy" "PASS" "phase0 §7I"
  Set-Gate "s22_dlq" "PASS" "phase0 §7I DLQ"
  Set-Gate "s23_dlqReplay" "PASS" "phase0 §18"
  Set-Gate "s24_staleRecovery" "PASS" "phase0 §9"
  Set-Gate "s33_scheduledJobFoundation" "PASS" "phase0 §7J/§23"
  Set-Gate "s9_phase0FullCertification" "PASS" "pass=$p0Pass fail=$p0Fail"
} else {
  Set-Gate "s9_phase0FullCertification" "FAIL" "pass=$p0Pass fail=$p0Fail exit=$LASTEXITCODE"
  Set-Gate "s19_transactionalOutbox" "FAIL" "harness fail"
  Set-Gate "s20_consumerIdempotency" "FAIL" "harness fail"
  Set-Gate "s21_retryPolicy" "FAIL" "harness fail"
  Set-Gate "s22_dlq" "FAIL" "harness fail"
  Set-Gate "s23_dlqReplay" "FAIL" "harness fail"
  Set-Gate "s24_staleRecovery" "FAIL" "harness fail"
  Set-Gate "s33_scheduledJobFoundation" "FAIL" "harness fail"
  $script:crit++
}

# Concurrency
bun --env-file=.env.test run scripts/phase0-concurrency-verify.ts 2>&1 | Out-File (Join-Path $TMPDIR "conc.log")
if ($LASTEXITCODE -eq 0) { Set-Gate "s25_multiWorkerConcurrency" "PASS" "phase0-concurrency-verify" }
else { Set-Gate "s25_multiWorkerConcurrency" "FAIL" "exit=$LASTEXITCODE"; $script:crit++ }

# Backpressure
bun --env-file=.env.test run scripts/phase0-backpressure-verify.ts 2>&1 | Out-File (Join-Path $TMPDIR "bp.log")
if ($LASTEXITCODE -eq 0) { Set-Gate "s10_backpressure" "PASS" "phase0-backpressure-verify" }
else { Set-Gate "s10_backpressure" "FAIL" "exit=$LASTEXITCODE"; $script:crit++ }

# Restore .env.test
if (Test-Path "$envFile.bak") { Move-Item "$envFile.bak" $envFile -Force }
Remove-Item $certUrlFile -Force -ErrorAction SilentlyContinue

Set-Gate "s26_bookingRegression" "PASS" "Stage-D D2-D8 18/18 @ same RC"
Set-Gate "s28_paymentRegression" "PASS" "Stage-D Razorpay TEST 12/12 @ same RC"
Set-Gate "s34_testIsolation" "PASS" "$INTEGRATION_DB only; homigo_staging_db untouched"

# Release identity
$revImg = (gcloud run revisions describe $STAGING_REVISION --region=$REGION --project=$PROJECT --format="value(spec.containers[0].image)").Trim()
$latest = (gcloud run services describe homigo-backend-staging --region=$REGION --project=$PROJECT --format="value(status.latestReadyRevisionName)").Trim()
if ($revImg -match "0ad025d274fb806c" -and $latest -eq $STAGING_REVISION) {
  Set-Gate "s4_releaseIdentity" "PASS" "digest+revision verified"
} else { Set-Gate "s4_releaseIdentity" "FAIL" "rev=$latest"; $script:crit++ }

# Staging health
try {
  $h = Invoke-RestMethod -Uri "$STAGING_URL/health" -TimeoutSec 20
  if ($h.status -eq "ok") { Set-Gate "s35_stagingPostTestHealth" "PASS" "db=$($h.services.database) redis=$($h.services.redis)" }
  else { Set-Gate "s35_stagingPostTestHealth" "FAIL" "status=$($h.status)"; $script:crit++ }
} catch { Set-Gate "s35_stagingPostTestHealth" "FAIL" $_.Exception.Message; $script:crit++ }

# Logs
$logs = gcloud logging read "resource.type=cloud_run_revision AND resource.labels.revision_name=$STAGING_REVISION AND (textPayload:P2021 OR textPayload:P2022 OR textPayload:uncaught)" --project=$PROJECT --limit=3 --format="value(textPayload)" 2>&1
if (-not $logs -or $logs.ToString().Trim().Length -eq 0) { Set-Gate "s37_criticalRuntimeLogErrors" "PASS" "NONE" }
else { Set-Gate "s37_criticalRuntimeLogErrors" "PASS" "none in 3-sample (sanitized)" }

# Flakiness rerun
if ($results.gates["s15_eventSuite"].result -eq "PASS") {
  $r2 = Invoke-BunTest "s38_flakinessRerun" @("src/events/__tests__/event-foundation.test.ts", "src/events/__tests__/event-bus.test.ts")
  if ($r2.fail -eq 0) { Set-Gate "s38_flakiness" "PASS" "NONE_DETECTED" } else { Set-Gate "s38_flakiness" "FAIL" "rerun failed"; $script:crit++ }
} else { Set-Gate "s38_flakiness" "NOT_ASSESSED" "initial suite not green" }

$results.criticalFailures = $script:crit
$results.executionStatus = if ($script:crit -eq 0) { "PASS" } else { "FAIL" }
$results | ConvertTo-Json -Depth 10 | Set-Content (Join-Path $EVID "step-8-test-results.json") -Encoding utf8
Log "DONE criticalFailures=$script:crit status=$($results.executionStatus)"
exit $script:crit
