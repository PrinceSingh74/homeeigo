#!/bin/bash
# Redeploy Alertmanager with Slack webhook from base64 file — never prints URL.
set -euo pipefail
OBS=~/obs-staging
B64_FILE="${1:-/tmp/staging-slack.b64}"
if [[ ! -s "$B64_FILE" ]]; then
  echo "SLACK_B64_FILE_MISSING"
  exit 1
fi
export STAGING_SLACK_WEBHOOK_URL="$(base64 -d "$B64_FILE")"
rm -f "$B64_FILE"
# docker-compose validates all services; Grafana password not needed for AM-only redeploy
export GRAFANA_ADMIN_PASSWORD="${GRAFANA_ADMIN_PASSWORD:-am-redeploy-placeholder}"
cd "$OBS"
sudo -E docker-compose stop alertmanager 2>/dev/null || true
sudo -E docker-compose rm -f alertmanager 2>/dev/null || true
sudo -E docker-compose up -d --no-deps alertmanager
sleep 6
curl -sf http://localhost:9093/-/healthy >/dev/null
echo "ALERTMANAGER_REDEPLOY=OK"
