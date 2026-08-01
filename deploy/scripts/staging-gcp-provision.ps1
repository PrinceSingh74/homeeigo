# GCP staging provisioning — homigo-497619 / asia-south1
# Run after NEW_PHASE_0_STAGING_RC_SHA is committed and image is built.
# Requires: gcloud auth, billing enabled, owner/editor on project.

$ErrorActionPreference = "Stop"
$PROJECT = "homigo-497619"
$REGION = "asia-south1"
$SQL_INSTANCE = "homigo-staging-db"
$REDIS_INSTANCE = "homigo-staging-redis"
$CONNECTOR = "homigo-staging-vpc"
$SA = "homigo-backend-staging"
$REPO = "homigo"
$SERVICE = "homigo-backend-staging"

Write-Host "Enabling required APIs..."
gcloud services enable `
  secretmanager.googleapis.com `
  vpcaccess.googleapis.com `
  redis.googleapis.com `
  servicenetworking.googleapis.com `
  compute.googleapis.com `
  --project=$PROJECT

Write-Host "Creating Artifact Registry (if missing)..."
gcloud artifacts repositories describe $REPO --location=$REGION --project=$PROJECT 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud artifacts repositories create $REPO `
    --repository-format=docker `
    --location=$REGION `
    --description="Homigo container images" `
    --project=$PROJECT
}

Write-Host "Private service connection for Cloud SQL / Memorystore..."
gcloud compute addresses describe google-managed-services-default --global --project=$PROJECT 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud compute addresses create google-managed-services-default `
    --global `
    --purpose=VPC_PEERING `
    --prefix-length=16 `
    --network=default `
    --project=$PROJECT
  gcloud services vpc-peerings connect `
    --service=servicenetworking.googleapis.com `
    --ranges=google-managed-services-default `
    --network=default `
    --project=$PROJECT
}

Write-Host "Creating Cloud SQL instance (10-15 min)..."
gcloud sql instances describe $SQL_INSTANCE --project=$PROJECT 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud sql instances create $SQL_INSTANCE `
    --project=$PROJECT `
    --database-version=POSTGRES_16 `
    --tier=db-f1-micro `
    --region=$REGION `
    --storage-size=10GB `
    --storage-auto-increase `
    --backup-start-time=03:00 `
    --availability-type=zonal `
    --no-assign-ip `
    --network=default
}

Write-Host "Creating staging database + user..."
gcloud sql databases create homigo_staging_db --instance=$SQL_INSTANCE --project=$PROJECT 2>$null
$DB_PASS = [Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ }))
gcloud sql users create homigo_staging_app --instance=$SQL_INSTANCE --password=$DB_PASS --project=$PROJECT 2>$null

Write-Host "VPC connector..."
gcloud compute networks vpc-access connectors describe $CONNECTOR --region=$REGION --project=$PROJECT 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud compute networks vpc-access connectors create $CONNECTOR `
    --region=$REGION `
    --network=default `
    --range=10.8.0.0/28 `
    --project=$PROJECT
}

Write-Host "Memorystore Redis (5-10 min)..."
gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --project=$PROJECT 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud redis instances create $REDIS_INSTANCE `
    --size=1 `
    --region=$REGION `
    --tier=basic `
    --network=default `
    --project=$PROJECT
}

$REDIS_HOST = gcloud redis instances describe $REDIS_INSTANCE --region=$REGION --project=$PROJECT --format="value(host)"
$CONN = "${PROJECT}:${REGION}:${SQL_INSTANCE}"
$DB_URL = "postgresql://homigo_staging_app:${DB_PASS}@localhost/homigo_staging_db?host=/cloudsql/${CONN}"
$REDIS_URL = "redis://${REDIS_HOST}:6379"

function Ensure-Secret($Name, $Value) {
  gcloud secrets describe $Name --project=$PROJECT 2>$null
  if ($LASTEXITCODE -ne 0) {
    $Value | gcloud secrets create $Name --data-file=- --project=$PROJECT
  } else {
    $Value | gcloud secrets versions add $Name --data-file=- --project=$PROJECT
  }
}

Write-Host "Writing Secret Manager secrets (values not printed)..."
Ensure-Secret "STAGING_DATABASE_URL" $DB_URL
Ensure-Secret "STAGING_REDIS_URL" $REDIS_URL
Ensure-Secret "STAGING_JWT_SECRET" (-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
Ensure-Secret "STAGING_JWT_REFRESH_SECRET" (-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
Ensure-Secret "STAGING_ENCRYPTION_KEY" (-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) }))
Ensure-Secret "STAGING_RESEND_API_KEY" ""
# Razorpay TEST keys — human must update via dashboard:
Ensure-Secret "STAGING_RAZORPAY_KEY_ID" "PLACEHOLDER_CONFIGURE_IN_DASHBOARD"
Ensure-Secret "STAGING_RAZORPAY_KEY_SECRET" "PLACEHOLDER_CONFIGURE_IN_DASHBOARD"
Ensure-Secret "STAGING_RAZORPAY_WEBHOOK_SECRET" "PLACEHOLDER_CONFIGURE_IN_DASHBOARD"

Write-Host "Service account + IAM..."
gcloud iam service-accounts describe "${SA}@${PROJECT}.iam.gserviceaccount.com" --project=$PROJECT 2>$null
if ($LASTEXITCODE -ne 0) {
  gcloud iam service-accounts create $SA --display-name="Homigo Backend Staging" --project=$PROJECT
}
$SA_EMAIL = "${SA}@${PROJECT}.iam.gserviceaccount.com"
foreach ($secret in @("STAGING_DATABASE_URL","STAGING_REDIS_URL","STAGING_JWT_SECRET","STAGING_JWT_REFRESH_SECRET","STAGING_ENCRYPTION_KEY","STAGING_RAZORPAY_KEY_ID","STAGING_RAZORPAY_KEY_SECRET","STAGING_RAZORPAY_WEBHOOK_SECRET","STAGING_RESEND_API_KEY")) {
  gcloud secrets add-iam-policy-binding $secret `
    --member="serviceAccount:$SA_EMAIL" `
    --role="roles/secretmanager.secretAccessor" `
    --project=$PROJECT 2>$null
}
gcloud projects add-iam-policy-binding $PROJECT `
  --member="serviceAccount:$SA_EMAIL" `
  --role="roles/cloudsql.client" `
  --quiet 2>$null

Write-Host "Done. Deploy with: deploy/scripts/staging-gcp-deploy.ps1 -CommitSha <SHA>"
