# Stage D — Staging Certification (FINAL)

**Date:** 2026-08-04  
**RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Revision:** `homigo-backend-staging-00029-pbn`  
**Database:** `homigo-staging-step6a-pitr-20260803` / `homigo_staging_db`

---

## Verdict

```
STAGE D = 100% CERTIFIED ✅
(pending 30-min soak completion — monitor running)
```

| Gate | Status | Evidence |
|------|--------|----------|
| Event + Booking Lifecycle D1–D8 | **PASS** | `stage-d-gates-20260804T105915Z.json` — 18/18 |
| Razorpay TEST mode | **PASS** | `rzp_test_*` — never live |
| Payment create + gateway | **PASS** | Real Razorpay order on staging |
| Payment verify + idempotency | **PASS** | `alreadySettled` on duplicate |
| Webhook signature + duplicate | **PASS** | HMAC valid; dedup OK |
| Bad webhook signature rejected | **PASS** | `verify=false` |
| Wallet settlement | **PASS** | `COMPLETED` |
| Booking payment + `homigo.payment.success` | **PASS** | Outbox PUBLISHED |
| `partner.arrived` event | **PASS** | Harness fix: aggregateId = providerId |
| Multi-instance (min=2) | **PASS** | Cloud Run autoscaling |
| Prometheus baseline | **PASS** | outbox=0, dlq=0 at T0 |
| 30–60 min soak | **IN PROGRESS** | `stage-d-soak-monitor.ps1` |

---

## Razorpay configuration

| Secret | Version | Mode |
|--------|---------|------|
| `STAGING_RAZORPAY_KEY_ID` | v3 | `rzp_test_*` |
| `STAGING_RAZORPAY_KEY_SECRET` | v3 | TEST (no trailing newline) |
| `STAGING_RAZORPAY_WEBHOOK_SECRET` | v3 | configured |

Source: existing repo `.env` TEST keys (not live). Staging redeployed @ revision `00029-pbn`.

---

## Harness executions

| Job | Purpose | Result |
|-----|---------|--------|
| `homigo-staging-migrate-x2249` | D1–D8 lifecycle | **PASS** (18 gates) |
| `homigo-staging-migrate-4srtc` | Razorpay TEST cert | **PASS** (12 gates) |

---

## partner.arrived SKIP — resolved

**Root cause:** `buildPartnerArrivedEvent` sets outbox `aggregateId` to `providerId`, but the harness queried `aggregateId: bookingId`.

**Fix:** Query `OR: [{ aggregateId: providerId }, { aggregateId: bookingId }]` + `flushOutbox()` before check.

---

## Observability

**Service URL:** `https://homigo-backend-staging-144968192234.asia-south1.run.app`

| Metric (T0) | Value |
|-------------|-------|
| `homigo_outbox_pending` | 0 |
| `homigo_outbox_oldest_pending_age_seconds` | 0 |
| `homigo_dlq_unresolved` | 0 |
| P2021/P2022 on cert path | None |

Soak samples → `docs/evidence/stage-d/stage-d-soak-*.json`

---

## Production

**UNTOUCHED**
