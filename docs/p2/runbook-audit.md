# Runbook Audit

**Date:** 2026-06-14 · **Location:** `docs/runbooks/` · **STATUS: PASS (8 runbooks created).**

| # | Runbook | Covers |
|---|---|---|
| 01 | incident-response | general triage, severity, comms |
| 02 | production-outage | backend down, postgres, restart, rollback |
| 03 | payment-failure | razorpay, webhook sig, reconcile, ledger drift |
| 04 | database-restore | scratch-first restore, RTO 0.9m/RPO 1.2m, no manual financial edits |
| 05 | redis-failure | in-memory fallbacks, cache-only impact |
| 06 | websocket-failure | auth 4401, fan-out, reconnect recovery |
| 07 | rollback | app + migration safety, additive-geofence note |
| 08 | security-incident | key rotation, exposure grep, RBAC/IDOR, webhook replay |

Each: trigger/symptoms → numbered actions → verification → escalation. DR timings from the executed `p2:dr` drill.
