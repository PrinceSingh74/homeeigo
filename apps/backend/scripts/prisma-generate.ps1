# Fix Windows EPERM when prisma generate cannot replace query_engine DLL.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot/..

Write-Host "Stopping processes that lock Prisma engine..." -ForegroundColor Cyan
Get-CimInstance Win32_Process -Filter "Name = 'bun.exe' OR Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object {
    $_.CommandLine -match 'homigo\\apps\\backend' -or
    $_.CommandLine -match 'schema-engine' -or
    $_.CommandLine -match 'prisma\\'
  } |
  ForEach-Object {
    Write-Host "  Stopping PID $($_.ProcessId) ($($_.Name))"
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
Start-Sleep -Seconds 3

if (Test-Path "node_modules\.prisma\client") {
  Write-Host "Removing stale Prisma client..." -ForegroundColor Cyan
  Remove-Item -Recurse -Force "node_modules\.prisma\client" -ErrorAction SilentlyContinue
}

Write-Host "Generating Prisma Client..." -ForegroundColor Cyan
bunx prisma generate
Write-Host "Done." -ForegroundColor Green
