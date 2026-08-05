#!/bin/bash
set -euo pipefail
echo "=== AM webhook configured (redacted) ==="
sudo docker exec homigo-am-staging sh -c "grep slack_api_url /tmp/alertmanager.yml" | sed -E 's|https://hooks\.slack\.com[^"]*|hooks.slack.com/REDACTED|'
echo "=== Wait 90s for dispatch ==="
sleep 90
echo "=== AM log line count ==="
sudo docker logs homigo-am-staging 2>&1 | wc -l
echo "=== AM notify-related logs ==="
sudo docker logs homigo-am-staging 2>&1 | grep -iE 'notify|slack|webhook|dispatch|error|success|failed' | sed -E 's|https://hooks\.slack\.com[^ ]*|[REDACTED]|g' || echo "NO_NOTIFY_LOGS"
