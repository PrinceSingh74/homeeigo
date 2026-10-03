<#
.SYNOPSIS
  Local staging deployment of the HOMEEIGO backend container against the isolated staging data
  plane (apps/backend/docker-compose.staging.yml: homigo-staging-postgres / -redis / -pgbouncer).

  This is the deployment path that is actually available on this machine: the GCP project
  (homigo-497619) has billing disabled and its Cloud SQL instances are SUSPENDED, so the Cloud Run
  manifests in deploy/cloud-run cannot be applied. The backend image is the SAME Dockerfile Cloud
  Run / Kubernetes would run; only the host differs.

.USAGE
  ./deploy-backend.ps1 build    -Tag <sha>            # docker build apps/backend -> homigo/backend:<sha>
  ./deploy-backend.ps1 migrate  -Tag <sha>            # prisma migrate deploy inside the image (staging DB)
  ./deploy-backend.ps1 deploy   -Tag <sha>            # start homigo-staging-backend on :3010 from that image
  ./deploy-backend.ps1 rollback -Tag <previous-sha>   # same as deploy, named for the audit trail
  ./deploy-backend.ps1 status                         # running image, /health, /ready
  ./deploy-backend.ps1 stop

  Secrets come from deploy/local-staging/backend.env (gitignored; see backend.env.example).
  Nothing in this script prints a secret value.
#>
param(
  [Parameter(Position = 0, Mandatory = $true)][ValidateSet("build", "migrate", "deploy", "rollback", "status", "stop")] [string] $Action,
  [string] $Tag,
  [int] $Port = 3010,
  [string] $Container = "homigo-staging-backend",
  [string] $Image = "homigo/backend",
  [string] $Network = "homigo-staging_default"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$backend = Join-Path $root "apps\backend"
$envFile = Join-Path $PSScriptRoot "backend.env"

function Require-Tag { if (-not $Tag) { throw "-Tag <git sha> is required for $Action" } }
function Require-EnvFile {
  if (-not (Test-Path $envFile)) { throw "missing $envFile — copy backend.env.example and fill in staging-only secrets" }
  $names = (Get-Content $envFile | Where-Object { $_ -match '^[A-Z_0-9]+=' } | ForEach-Object { ($_ -split '=', 2)[0] })
  foreach ($k in 'DATABASE_URL', 'REDIS_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY', 'OTP_SECRET', 'APP_ENV') {
    if ($names -notcontains $k) { throw "backend.env is missing $k" }
  }
  $db = (Get-Content $envFile | Where-Object { $_ -like 'DATABASE_URL=*' } | Select-Object -First 1) -split '=', 2 | Select-Object -Last 1
  $dbName = ($db -split '/')[-1] -split '\?' | Select-Object -First 1
  if ($dbName -notmatch 'staging') { throw "refusing: backend.env DATABASE_URL database '$dbName' is not a staging database" }
}
function Wait-Health([int] $seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $h = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 3
      if ($h.StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 2
  }
  return $false
}

switch ($Action) {
  "build" {
    Require-Tag
    Push-Location $backend
    try {
      docker build -t "${Image}:$Tag" --label "org.opencontainers.image.revision=$Tag" .
      if ($LASTEXITCODE -ne 0) { throw "docker build failed" }
      docker image inspect "${Image}:$Tag" --format 'built {{.Id}} created {{.Created}} revision {{index .Config.Labels "org.opencontainers.image.revision"}}'
    } finally { Pop-Location }
  }
  "migrate" {
    Require-Tag; Require-EnvFile
    # Same image, same schema files, one-shot: the deploy never runs against a schema it did not migrate.
    docker run --rm --network $Network --env-file $envFile "${Image}:$Tag" bunx prisma migrate deploy
    if ($LASTEXITCODE -ne 0) { throw "prisma migrate deploy failed" }
  }
  { $_ -in "deploy", "rollback" } {
    Require-Tag; Require-EnvFile
    $existing = docker ps -a --filter "name=^/$Container$" --format '{{.Image}}'
    if ($existing) { Write-Host "[$Action] replacing $Container (was $existing)"; docker rm -f $Container | Out-Null }
    docker run -d --name $Container --network $Network -p "${Port}:8080" --env-file $envFile `
      --label "homeeigo.release=$Tag" --label "homeeigo.action=$Action" "${Image}:$Tag" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "docker run failed" }
    if (-not (Wait-Health 90)) {
      Write-Host "[$Action] FAILED: /health did not return 200 within 90s. Last log lines:"
      docker logs --tail 40 $Container
      exit 1
    }
    $ready = try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/ready" -TimeoutSec 5).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
    Write-Host "[$Action] $Container running ${Image}:$Tag  health=200 ready=$ready"
  }
  "status" {
    $img = docker ps --filter "name=^/$Container$" --format '{{.Image}} ({{.Status}})'
    if (-not $img) { Write-Host "status: $Container not running"; exit 1 }
    $h = try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 5).StatusCode } catch { "ERR" }
    $r = try { (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/ready" -TimeoutSec 5).StatusCode } catch { $_.Exception.Response.StatusCode.value__ }
    Write-Host "status: $img health=$h ready=$r"
  }
  "stop" { docker rm -f $Container | Out-Null; Write-Host "stopped $Container" }
}
