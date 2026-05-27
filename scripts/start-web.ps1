# HOMIGO customer website — start dev server (Windows)
$ErrorActionPreference = "Stop"
$Port = 3001
$WebRoot = Join-Path $PSScriptRoot "..\apps\web"
$Url = "http://localhost:$Port"

Write-Host "HOMIGO customer web -> $Url" -ForegroundColor Cyan

function Stop-PortListener([int]$port) {
  $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if (-not $conns) { return }
  $pids = $conns.OwningProcess | Sort-Object -Unique
  foreach ($procId in $pids) {
    Write-Host "Stopping old process on port $port (PID $procId)..." -ForegroundColor Yellow
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Seconds 2
}

Stop-PortListener -port $Port

if (-not (Test-Path (Join-Path $WebRoot "node_modules"))) {
  Write-Host "Installing dependencies (first time)..." -ForegroundColor Yellow
  Push-Location $WebRoot
  npm install
  Pop-Location
}

Write-Host "Clearing caches (.next + webpack)..." -ForegroundColor Green
Push-Location $WebRoot
$nextDir = Join-Path $WebRoot ".next"
$cacheDir = Join-Path $WebRoot "node_modules\.cache"
if (Test-Path $nextDir) { Remove-Item -Recurse -Force $nextDir }
if (Test-Path $cacheDir) { Remove-Item -Recurse -Force $cacheDir }
Write-Host "Starting dev server (first compile may take 30-60s on OneDrive)..." -ForegroundColor Green
Start-Process $Url
npm run dev
