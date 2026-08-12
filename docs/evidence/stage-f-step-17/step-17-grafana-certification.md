# HOMIGO PHASE 0 / STAGE F — STEP 17 LIVE GRAFANA & PROMETHEUS CERTIFICATION

**Date:** 2026-08-05  
**STEP17_RUN_ID:** `stage17-f-20260805120630`

## Result: PASS_WITH_LIMITATION

Runtime observability chain verified end-to-end using a **reversible certification obsstack** (Prometheus `:9091` + Grafana `:3005`) scraping **live staging Cloud Run `/metrics`** with OPS authentication.

### Limitation
No permanently deployed staging Grafana/Prometheus exists in GCP (`homigo-497619`). Only `homigo-backend-staging` Cloud Run service is deployed. Certification used local Docker obsstack per Step 9 operational model.

### Verified
- Release identity matches certified RC `c31f154` / digest `sha256:0ad025…`
- `/health` 200, `/ready` 200 (OPS auth), `/metrics` 200 (OPS auth), valid Prometheus exposition
- Prometheus scrape `up=1`; all 6 required event-platform dashboard panels query successfully
- Counter movement after cert activity: publish success 301→329, booking.created 301→323
- Grafana dashboard `homigo-observability` loaded; event throughput and publish panels show movement
- Final outbox pending 0, DLQ 0

### Evidence
See `docs/evidence/stage-f-step-17/` JSON artifacts.
