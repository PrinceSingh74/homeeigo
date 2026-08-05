# Step 14 post-run DB reconciliation (read-only)
$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$JOB = "homigo-step14-reconcile"
$IMAGE = "asia-south1-docker.pkg.dev/homigo-497619/homigo/backend:c31f154"
$SQL = "homigo-497619:asia-south1:homigo-staging-step6a-pitr-20260803"
$SA = "homigo-backend-staging@homigo-497619.iam.gserviceaccount.com"
$SECRET = "STAGING_STEP14_RECON_SCRIPT"
$ScriptPath = Join-Path $PSScriptRoot "stage-e-step-14-reconcile.ts"
$RUN_ID = if ($env:STEP14_RUN_ID) { $env:STEP14_RUN_ID } else { "stage14-outbox-drain-1785867261931" }

$secretExists = $false
try {
  gcloud secrets describe $SECRET --project=$PROJECT 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $secretExists = $true }
} catch {}
if (-not $secretExists) {
  gcloud secrets create $SECRET --project=$PROJECT --replication-policy="automatic"
  gcloud secrets add-iam-policy-binding $SECRET --project=$PROJECT `
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" | Out-Null
}
gcloud secrets versions add $SECRET --project=$PROJECT --data-file=$ScriptPath | Out-Null

$envFile = Join-Path $env:TEMP "step14-recon-env.yaml"
@"
NODE_ENV: production
APP_ENV: staging
STAGING_EVENTS_CERTIFICATION: "1"
STEP14_RUN_ID: "$RUN_ID"
"@ | Set-Content -Path $envFile -Encoding UTF8

gcloud run jobs deploy $JOB `
  --project=$PROJECT --region=$REGION --image=$IMAGE `
  --command=sh --args="-c,cd /app && bun /secrets/step14-recon.ts" `
  --set-cloudsql-instances=$SQL --vpc-connector=homigo-staging-vpc `
  --vpc-egress=private-ranges-only --service-account=$SA `
  --memory=512Mi --cpu=1 --max-retries=0 --task-timeout=300 `
  --env-vars-file=$envFile `
  --set-secrets="/secrets/step14-recon.ts=${SECRET}:latest,DATABASE_URL=STAGING_DATABASE_URL:latest"

$execName = gcloud run jobs execute $JOB --project=$PROJECT --region=$REGION --wait --format="value(metadata.name)"
Write-Output "EXEC=$execName"
gcloud logging read "resource.type=cloud_run_job AND resource.labels.job_name=$JOB AND labels.run.googleapis.com/execution_name=$execName" --project=$PROJECT --limit=50 --format="value(textPayload)" --freshness=30m
