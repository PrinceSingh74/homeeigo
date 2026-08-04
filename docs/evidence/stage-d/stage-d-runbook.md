# Stage D — Real Staging Certification Runbook

**Prerequisites:** Step 7 PASS (`PHASE_0_SCHEMA_CERTIFICATION=PASS`)  
**Environment:** STAGING ONLY — `homigo-staging-step6a-pitr-20260803`  
**Application RC baseline:** `e459175c72b1ece6e6246e5d69f559f23cd0a23e`  
**Stage D requires:** code with `STAGING_EVENTS_CERTIFICATION=1` opt-in (staging-safety patch)

---

## Certification flow

```
Real staging user
      ↓
Real booking creation → homigo.booking.created
      ↓
Partner assignment → homigo.booking.assigned + homigo.partner.dispatched
      ↓
Partner online / tracking updates
      ↓
en_route → homigo.partner.en_route (en_route_at set)
      ↓
arrived → homigo.partner.arrived (arrived_at, travel_duration_min)
      ↓
booking.started → homigo.booking.started
      ↓
booking.completed → homigo.booking.completed
      ↓
Controlled Razorpay TEST payment (optional gate — requires rzp_test_* secrets)
      ↓
Outbox persistence + consumer processing
      ↓
Duplicate delivery test + idempotency proof
      ↓
Intentional consumer failure → DLQ → operator replay
      ↓
Multi-instance concurrency (min-instances=2 on Cloud Run)
      ↓
Metrics + Prometheus alerts + Grafana dashboards
      ↓
30–60 min soak
      ↓
STAGE D CERTIFIED
```

---

## Phase 0 — Pre-flight (must pass before enabling events)

| Check | Command / source |
|-------|------------------|
| Step 7 schema PASS | `docs/evidence/stage-c-step-7/step-7-schema-certification.md` |
| `/health` `/ready` `/metrics` = 200 | curl staging URL |
| Backups + PITR ON | `gcloud sql instances describe homigo-staging-step6a-pitr-20260803` |
| Razorpay test keys only | Secret `STAGING_RAZORPAY_KEY_ID` must start with `rzp_test_` |

---

## Phase 1 — Controlled event enablement

### 1. Deploy with Stage D flags

```powershell
# From repo root — commit must include staging-safety STAGING_EVENTS_CERTIFICATION opt-in
D:\homigo\deploy\scripts\staging-gcp-deploy-stage-d.ps1 -CommitSha <SHA>

# Incremental: outbox only first
D:\homigo\deploy\scripts\staging-gcp-deploy-stage-d.ps1 -CommitSha <SHA> -OutboxOnly
```

**Env vars set:**

| Variable | Stage D value |
|----------|---------------|
| STAGING_EVENTS_CERTIFICATION | 1 |
| EVENTS_OUTBOX_ENABLED | true |
| EVENTS_CONSUMERS_ENABLED | true (or false with -OutboxOnly) |
| EVENTS_BOOKING_ENABLED | true |
| EVENTS_PAYMENT_ENABLED | true |
| EVENTS_TRACKING_ENABLED | true |
| EVENTS_PARTNER_ENABLED | true |

### 2. Verify revision

```powershell
gcloud run revisions describe homigo-backend-staging-000XX-xxx `
  --region=asia-south1 --project=homigo-497619 `
  --format="yaml(spec.containers[0].env)"
```

### 3. Rollback (immediate)

Set `EVENTS_OUTBOX_ENABLED=false` and `EVENTS_CONSUMERS_ENABLED=false` on Cloud Run.

---

## Phase 2 — Automated certification harness

Run via Cloud Run Job (recommended) or locally with staging secrets:

```bash
STAGING_EVENTS_CERTIFICATION=1 \
EVENTS_OUTBOX_ENABLED=true \
EVENTS_CONSUMERS_ENABLED=true \
EVENTS_BOOKING_ENABLED=true \
EVENTS_TRACKING_ENABLED=true \
EVENTS_PARTNER_ENABLED=true \
bun --env-file=.env.staging run scripts/stage-d-staging-certification.ts
```

Output: JSON gate report → save to `docs/evidence/stage-d/stage-d-gates-<timestamp>.json`

---

## Phase 3 — Payment (Razorpay TEST)

1. Confirm `STAGING_RAZORPAY_*` secrets are real test keys (not PLACEHOLDER)
2. Webhook URL: `https://homigo-backend-staging-144968192234.asia-south1.run.app/api/payments/webhook`
3. Use Razorpay test card flow per `docs/STAGING_DEPLOY_CHECKLIST.md` §7
4. Verify `homigo.payment.success` or `homigo.payment.failed` in `event_outbox`

**Note:** `/api/payments/e2e/mock-signature` is disabled when `NODE_ENV=production` (Cloud Run). Use real Razorpay test mode on staging.

---

## Phase 4 — Observability soak (30–60 min)

Watch during soak:

| Metric / alert | Source |
|----------------|--------|
| `homigo_outbox_pending` | `/metrics` (OPS auth) |
| `homigo_outbox_oldest_pending_age_seconds` | Prometheus |
| `homigo_consumer_failed_total` | Prometheus |
| `homigo_dlq_unresolved` | Prometheus |
| EventOutboxBacklogHigh | `apps/backend/monitoring/rules/` |

```powershell
# Poll metrics every 5 min for 60 min
$token = gcloud secrets versions access latest --secret=STAGING_OPS_AUTH_TOKEN --project=homigo-497619
curl -H "Authorization: Bearer $token" https://homigo-backend-staging-144968192234.asia-south1.run.app/metrics | Select-String homigo_outbox
```

**Pass criteria:** zero critical alerts; outbox pending stays bounded; no P2021 on Phase-0 tables.

---

## Phase 5 — Evidence

| Artifact | Path |
|----------|------|
| Runbook | `docs/evidence/stage-d/stage-d-runbook.md` |
| Gate JSON | `docs/evidence/stage-d/stage-d-gates-*.json` |
| Final cert | `docs/evidence/stage-d/stage-d-certification.md` |

---

## Kill switches

| Action | Effect |
|--------|--------|
| `EVENTS_OUTBOX_ENABLED=false` | Stop outbox processor immediately |
| `EVENTS_CONSUMERS_ENABLED=false` | Stop in-process consumers; outbox still accumulates |
| Redeploy Step 6D baseline | Events OFF, schema unchanged |

---

## What Stage D PASS means

- Real booking lifecycle exercised on authoritative staging DB
- Event outbox, consumers, idempotency, DLQ, and replay verified under load
- Razorpay TEST payment path validated (if secrets configured)
- 30–60 min soak with zero critical regression

**Stage D PASS does NOT mean:** production ready, full 48-migration schema parity, or live Razorpay.
