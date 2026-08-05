#!/bin/bash
# Step 18 final cert helper - runs ON homigo-obs-staging VM. Never prints webhook URLs.
set -euo pipefail
PROJECT=homigo-497619
OBS=~/obs-staging
POLL_FILE="${POLL_FILE:-/tmp/step18-final-poll.jsonl}"
: > "$POLL_FILE"

get_alerts() {
  curl -sf 'http://localhost:9090/api/v1/alerts' 2>/dev/null || echo '{"status":"error"}'
}

alert_state() {
  local name="$1"
  get_alerts | python3 -c "
import sys,json
name=sys.argv[1]
try:
 d=json.load(sys.stdin)
 alerts=d.get('data',{}).get('alerts',[])
 for a in alerts:
  if a.get('labels',{}).get('alertname')==name:
   print(a.get('state','inactive')); break
 else:
  print('inactive')
except Exception:
 print('unknown')
" "$name"
}

metric() {
  curl -sf "http://localhost:9090/api/v1/query?query=$1" | python3 -c "import sys,json;d=json.load(sys.stdin);r=d.get('data',{}).get('result',[]);print(r[0]['value'][1] if r else '0')" 2>/dev/null || echo "0"
}

poll_once() {
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  python3 - <<PY >> "$POLL_FILE"
import json,subprocess,datetime
ts="$ts"
names=["EventOutboxBacklogHigh","EventOutboxOldestPendingStale","EventConsumerFailureRateHigh","EventDlqGrowing","ScheduledJobLagHigh"]
alerts=json.loads(subprocess.check_output(["curl","-sf","http://localhost:9090/api/v1/alerts"]))
am=json.loads(subprocess.check_output(["curl","-sf","http://localhost:9093/api/v2/alerts"], stderr=subprocess.DEVNULL) if True else '{}')
states={}
for a in alerts.get("data",{}).get("alerts",[]):
 n=a.get("labels",{}).get("alertname")
 if n in names: states[n]={"state":a.get("state"),"activeAt":a.get("activeAt"),"value":a.get("value")}
for n in names:
 if n not in states: states[n]={"state":"inactive"}
metrics={
 "homigo_outbox_pending": subprocess.check_output(["bash","-c","curl -sf 'http://localhost:9090/api/v1/query?query=homigo_outbox_pending' | python3 -c \"import sys,json;d=json.load(sys.stdin);r=d.get('data',{}).get('result',[]);print(r[0]['value'][1] if r else '0')\""]).decode().strip(),
 "homigo_dlq_unresolved": subprocess.check_output(["bash","-c","curl -sf 'http://localhost:9090/api/v1/query?query=homigo_dlq_unresolved' | python3 -c \"import sys,json;d=json.load(sys.stdin);r=d.get('data',{}).get('result',[]);print(r[0]['value'][1] if r else '0')\""]).decode().strip(),
}
print(json.dumps({"ts":ts,"alerts":states,"metrics":metrics,"am_alert_count":len(am)}))
PY
}

redeploy_alertmanager_with_secret() {
  if ! gcloud secrets describe STAGING_SLACK_WEBHOOK_URL --project="$PROJECT" >/dev/null 2>&1; then
    echo "SLACK_SECRET_STATUS=NOT_FOUND"
    return 1
  fi
  SLACK_URL="$(gcloud secrets versions access latest --secret=STAGING_SLACK_WEBHOOK_URL --project="$PROJECT")"
  GRAFANA_PASS="$(gcloud secrets versions access latest --secret=STAGING_GRAFANA_ADMIN_PASSWORD --project="$PROJECT")"
  cd "$OBS"
  export STAGING_SLACK_WEBHOOK_URL="$SLACK_URL"
  export GRAFANA_ADMIN_PASSWORD="$GRAFANA_PASS"
  unset SLACK_URL
  sudo -E docker-compose up -d alertmanager 2>/dev/null || sudo -E docker compose up -d alertmanager
  sleep 5
  curl -sf http://localhost:9093/-/healthy >/dev/null && echo "SLACK_SECRET_STATUS=CONFIGURED_AM_HEALTHY"
  return 0
}

validate_configs() {
  cd "$OBS"
  sudo docker run --rm --entrypoint promtool -v "$OBS/rules:/rules:ro" prom/prometheus:v2.55.1 check rules /rules/homigo-alerts.yml
  sudo docker run --rm --entrypoint promtool -v "$OBS/rules:/rules:ro" prom/prometheus:v2.55.1 check rules /rules/homigo-enterprise-alerts.yml
  echo "PROMTOOL=PASS"
}

case "${1:-}" in
  redeploy-am) redeploy_alertmanager_with_secret ;;
  validate) validate_configs ;;
  poll) poll_once; cat "$POLL_FILE" | tail -1 ;;
  poll-loop)
    mins="${2:-20}"
    end=$((SECONDS + mins * 60))
    while [ $SECONDS -lt $end ]; do poll_once; sleep 30; done
    echo "POLL_DONE lines=$(wc -l < "$POLL_FILE")"
    ;;
  am-logs)
    sudo docker logs homigo-am-staging 2>&1 | tail -80 | grep -E 'notify|slack|Webhook|success|error|level=' | sed -E 's|https://hooks\.slack\.com[^ ]*|[REDACTED_WEBHOOK]|g' || true
    ;;
  *) echo "usage: $0 {redeploy-am|validate|poll|poll-loop|am-logs}" ;;
esac
