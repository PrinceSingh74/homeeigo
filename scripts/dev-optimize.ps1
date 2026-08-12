# HOMIGO dev-environment optimizer — frees RAM before a dev session.
# Run:  powershell -ExecutionPolicy Bypass -File scripts\dev-optimize.ps1

Write-Host "HOMIGO Dev Environment Optimization" -ForegroundColor Cyan
Write-Host ""

# 1) Stop monitoring containers (not needed while developing; ~1GB RAM)
Write-Host "Stopping monitoring containers (Prometheus, Grafana)..."
docker stop homigo-prometheus homigo-grafana 2>$null | Out-Null
Write-Host "  done - restart later with: docker start homigo-prometheus homigo-grafana"
Write-Host ""

# 2) Show what's still running (postgres/redis/pgbouncer must stay)
Write-Host "Essential containers still running:"
docker ps --format "  {{.Names}}  {{.Status}}"
Write-Host ""

# 3) RAM snapshot
$os = Get-CimInstance Win32_OperatingSystem
$freeGb = [math]::Round($os.FreePhysicalMemory / 1MB, 1)
$totalGb = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
Write-Host ("RAM free: {0} GB / {1} GB" -f $freeGb, $totalGb)
if ($freeGb -lt 3) {
  Write-Host ""
  Write-Host "TIP: still under memory pressure -" -ForegroundColor Yellow
  Write-Host "  - close Chrome tabs you don't need (Shift+Esc shows per-tab memory)"
  Write-Host "  - stop dev servers of apps you aren't working on (3001/3002/3003)"
}
Write-Host ""
Write-Host "Done. Start the app with: cd apps\web; npm run dev  (turbopack)" -ForegroundColor Green
