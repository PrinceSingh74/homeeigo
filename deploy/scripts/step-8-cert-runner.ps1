# Step 8 certification runner — execute from clean worktree
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File deploy/scripts/step-8-cert-runner.ps1
$ErrorActionPreference = "Stop"
$Sha = "c31f154a128022fa7d9c4e44652506eedf3fa3e4"
$WtRoot = Join-Path $env:TEMP "homigo-step8-c31f154"
$Backend = Join-Path $WtRoot "apps\backend"
$Results = Join-Path (Split-Path $Backend -Parent | Split-Path -Parent) "..\..\homigo\docs\evidence\stage-d-step-8\step-8-test-results.json"

if (-not (Test-Path $Backend)) {
  git -C D:\homigo worktree add --detach $WtRoot $Sha
}
Copy-Item "D:\homigo\apps\backend\.env.test" (Join-Path $Backend ".env.test") -Force

Push-Location $Backend
try {
  bun install
  bun --env-file=.env.test exec bunx prisma validate
  bun --env-file=.env.test exec bunx prisma generate
  bun run type-check
  bun run build

  Write-Host "=== Event suite ==="
  bun test src/events/__tests__/ 2>&1 | Tee-Object -Variable eventOut

  Write-Host "=== Regression 13 ==="
  bun test src/__tests__/p0-blockers.test.ts src/__tests__/assignment-engine.test.ts 2>&1 | Tee-Object -Variable regOut

  Write-Host "=== Pure unit bundle ==="
  bun test src/events/__tests__/event-foundation.test.ts src/events/__tests__/event-failure-scenarios.test.ts src/events/__tests__/event-bus.test.ts src/lib/__tests__/staging-safety.test.ts src/__tests__/observability.test.ts 2>&1

  Write-Host "Done — update step-8-test-results.json manually from output"
} finally {
  Pop-Location
}
