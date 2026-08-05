#!/bin/bash
# Post connectivity probe to Alertmanager — no secrets printed.
set -euo pipefail
curl -sf -XPOST http://localhost:9093/api/v2/alerts \
  -H 'Content-Type: application/json' \
  -d '[{"labels":{"alertname":"Step18SlackConnectivityTest","severity":"warning","environment":"staging"},"annotations":{"summary":"Step 18 Slack connectivity probe"},"startsAt":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}]'
echo "TEST_ALERT_POSTED"
sleep 40
sudo docker logs homigo-am-staging 2>&1 | tail -25 | sed -E 's|https://hooks\.slack\.com[^ ]*|[REDACTED]|g'
