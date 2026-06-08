# HOMIGO local DB — requires Docker Desktop running
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

Write-Host "Starting PostgreSQL on port 5433..." -ForegroundColor Cyan
docker compose up -d

Write-Host "Waiting for database..." -ForegroundColor Cyan
Start-Sleep -Seconds 4

Write-Host "Running migrations..." -ForegroundColor Cyan
bun run db:migrate

Write-Host "Seeding demo data (optional)..." -ForegroundColor Cyan
bun run db:seed

Write-Host "`nDone. Restart backend: bun run dev" -ForegroundColor Green
Write-Host "Demo login: customer@homigo.demo / Homigo@123" -ForegroundColor Green
