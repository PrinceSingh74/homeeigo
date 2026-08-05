# Deploy permanent staging observability stack (Prometheus + Grafana + Alertmanager)
# STAGING ONLY. Does NOT touch production or certified application RC.
param(
  [switch]$DryRun,
  [switch]$SkipVmCreate,
  [string]$Project = "homigo-497619",
  [string]$Region = "asia-south1",
  [string]$Zone = "asia-south1-b",
  [string]$VmName = "homigo-obs-staging"
)

$ErrorActionPreference = "Stop"
function Invoke-GcloudQuiet {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Args)
  $prev = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  & gcloud @Args 2>&1 | Out-Null
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prev
  return $code
}
$ObsDir = $PSScriptRoot
$StagingUrl = "homigo-backend-staging-144968192234.asia-south1.run.app"

Write-Host "=== HOMIGO Staging Observability Deploy ==="
Write-Host "Project=$Project Region=$Region VM=$VmName"

# --- Secrets (never printed) ---
$opsToken = (gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=$Project 2>&1 | Out-String).Trim()
$grafanaPass = $null
try {
  $grafanaPass = (gcloud secrets versions access latest --secret=STAGING_GRAFANA_ADMIN_PASSWORD --project=$Project 2>$null).Trim()
} catch {}
if (-not $grafanaPass) {
  $grafanaPass = -join ((48..57) + (65..90) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  Write-Host "Creating STAGING_GRAFANA_ADMIN_PASSWORD secret..."
  if (-not $DryRun) {
    if ((Invoke-GcloudQuiet secrets describe STAGING_GRAFANA_ADMIN_PASSWORD --project=$Project) -ne 0) {
      Invoke-GcloudQuiet secrets create STAGING_GRAFANA_ADMIN_PASSWORD --project=$Project --replication-policy=automatic
    }
    $tmpPass = Join-Path $env:TEMP "grafana-pass.txt"
    Set-Content -Path $tmpPass -Value $grafanaPass -NoNewline
    Invoke-GcloudQuiet secrets versions add STAGING_GRAFANA_ADMIN_PASSWORD --project=$Project --data-file=$tmpPass
    Remove-Item $tmpPass -Force -ErrorAction SilentlyContinue
  }
}

$slackUrl = ""
try {
  $slackUrl = (gcloud secrets versions access latest --secret=STAGING_SLACK_WEBHOOK_URL --project=$Project 2>$null).Trim()
} catch {}
if (-not $slackUrl) {
  Write-Host "WARN: STAGING_SLACK_WEBHOOK_URL not found — Alertmanager Slack delivery will be NOT_CONFIGURED"
  $slackUrl = "https://hooks.slack.com/services/DISABLED/STAGING/NOT_CONFIGURED"
}

# --- Local secrets dir for compose ---
$secretsDir = Join-Path $ObsDir "secrets"
New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
Set-Content -Path (Join-Path $secretsDir "ops-token") -Value $opsToken -NoNewline

# --- VM ---
if (-not $SkipVmCreate) {
  $exists = gcloud compute instances describe $VmName --project=$Project --zone=$Zone 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating GCE VM $VmName [e2-small]..."
    if (-not $DryRun) {
      gcloud compute instances create $VmName `
        --project=$Project `
        --zone=$Zone `
        --machine-type=e2-small `
        --boot-disk-size=30GB `
        --image-family=ubuntu-2204-lts `
        --image-project=ubuntu-os-cloud `
        --tags=homigo-obs-staging `
        --scopes=cloud-platform `
        --metadata=enable-oslogin=true
      gcloud compute firewall-rules create homigo-obs-staging-iap `
        --project=$Project `
        --direction=INGRESS `
        --priority=1000 `
        --network=default `
        --action=ALLOW `
        --rules=tcp:3000,tcp:9090 `
        --source-ranges=35.235.240.0/20 `
        --target-tags=homigo-obs-staging `
        2>$null
    }
  } else {
    Write-Host "VM $VmName already exists"
  }
}

if ($DryRun) {
  Write-Host "[DRY RUN] Would sync configs and start docker compose on VM"
  exit 0
}

# --- Package and copy to VM ---
$tarPath = Join-Path $env:TEMP "homigo-obs-staging.tar.gz"
if (Get-Command tar -ErrorAction SilentlyContinue) {
  Push-Location $ObsDir
  tar -czf $tarPath prometheus.yml alertmanager-staging.yml docker-compose.yml grafana rules secrets/ops-token 2>$null
  Pop-Location
  gcloud compute scp $tarPath "${VmName}:~/obs-staging.tar.gz" --project=$Project --zone=$Zone
} else {
  Write-Host "tar not found — using gcloud scp for directory"
  gcloud compute scp --recurse $ObsDir "${VmName}:~/obs-staging" --project=$Project --zone=$Zone
}

$remoteScript = @"
set -e
sudo apt-get update -qq
sudo apt-get install -y docker.io docker-compose-plugin 2>/dev/null || sudo apt-get install -y docker.io docker-compose
sudo usermod -aG docker `$USER || true
mkdir -p ~/obs-staging && cd ~/obs-staging
if [ -f ~/obs-staging.tar.gz ]; then tar -xzf ~/obs-staging.tar.gz; fi
export GRAFANA_ADMIN_PASSWORD='$grafanaPass'
export STAGING_SLACK_WEBHOOK_URL='$slackUrl'
export GRAFANA_ROOT_URL='http://localhost:3000'
sudo docker compose down 2>/dev/null || true
sudo -E docker compose up -d
sleep 15
curl -sf http://localhost:9090/-/ready && echo PROMETHEUS_READY
curl -sf http://localhost:3000/api/health && echo GRAFANA_READY
"@

$remoteScript | gcloud compute ssh $VmName --project=$Project --zone=$Zone --command="bash -s"

Write-Host "=== Deploy complete ==="
Write-Host "Grafana: IAP tunnel -> gcloud compute ssh $VmName --project=$Project --zone=$Zone -- -L 3000:localhost:3000"
Write-Host "Prometheus: IAP tunnel port 9090"
Write-Host "OPS_TOKEN_PRESENT=true GRAFANA_SECRET=STAGING_GRAFANA_ADMIN_PASSWORD"
Write-Host "STAGING_SLACK_CONFIGURED=$([bool]($slackUrl -notmatch 'NOT_CONFIGURED'))"
