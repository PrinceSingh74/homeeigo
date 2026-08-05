#!/bin/bash
curl -sf http://localhost:9090/api/v1/alerts > /tmp/alerts.json
python3 <<'PY'
import json
names=["EventOutboxBacklogHigh","EventOutboxOldestPendingStale","EventConsumerFailureRateHigh","EventDlqGrowing","ScheduledJobLagHigh"]
d=json.load(open("/tmp/alerts.json"))
for n in names:
 s=next((a["state"] for a in d["data"]["alerts"] if a["labels"].get("alertname")==n),"inactive")
 print(f"{n}={s}")
PY
