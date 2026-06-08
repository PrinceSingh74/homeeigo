# Reset local dev database and re-apply all Prisma migrations (destroys all data).
# Use when migrate dev reports drift or a failed migration.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

Write-Host "Stopping stray Bun dev servers (avoids Prisma EPERM on Windows)..." -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name = 'bun.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'homigo\\apps\\backend' -or $_.CommandLine -match 'src\\index\.ts' } |
  ForEach-Object {
    Write-Host "  Stopping PID $($_.ProcessId)"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 2

Write-Host "Starting PostgreSQL..." -ForegroundColor Cyan
docker compose up -d
Start-Sleep -Seconds 4

Write-Host "Resetting database and applying migrations..." -ForegroundColor Cyan
bunx prisma migrate reset --force

Write-Host "Generating Prisma Client..." -ForegroundColor Cyan
bun run db:generate

Write-Host "Seeding demo data..." -ForegroundColor Cyan
bun run db:seed

Write-Host "`nDone. Start backend: bun run dev" -ForegroundColor Green
Write-Host "Demo login: customer@homigo.demo / Homigo@123" -ForegroundColor Green
