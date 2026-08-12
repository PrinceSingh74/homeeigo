# Payment Audit Report

**Audit date:** 2026-06-10  
**Gateway:** Razorpay (configured: **NO** in current env)

---

## Integration Status (`GET /ready`)

```json
"integrations": {
  "razorpay": { "configured": false },
  "razorpayWebhook": { "configured": false }
}
```

Live Razorpay order capture, webhook HMAC verification, and settlement sync against real gateway **NOT EXECUTED**.

---

## Dev-Mode Payment Paths (test evidence)

| Flow | Evidence | Result |
|------|----------|--------|
| Create order (wallet top-up) | `production-blocker-final.test.ts` — `order_dev_*` created | ✅ |
| Wallet credit on success | adversarial test with ledger | ✅ rollback on ledger fail |
| Idempotency | wallet txn idempotency_key checks in tests | ✅ PASS |
| 1M paise accumulation | zero drift test | ✅ PASS |
| Payment reconcile job | scheduler exists (1h interval) | ⚠️ not observed running |
| Refund workflow | admin finance smoke 200 | ✅ API reachable |
| Membership purchase | subscription APIs work; premium smoke partial fail | ⚠️ |
| Gift card | routes exist; not probed | ⚠️ |
| Ledger entries | wallet-integrity 100/100 | ✅ |

---

## Flow Matrix

| Flow | Create Order | Success | Failure | Retry | Refund | Ledger Match |
|------|-------------|---------|---------|-------|--------|--------------|
| Booking payment | dev mock | test only | test rollback | — | admin API | ✅ tests |
| Wallet topup | dev mock | test | rollback tested | — | — | ✅ |
| Membership | API exists | ⚠️ cashback smoke fail | — | — | — | ⚠️ |
| Gift card | code exists | ❌ | ❌ | ❌ | ❌ | ❌ |
| Webhook processing | endpoint exists | ❌ no secret | ❌ | ❌ | — | ❌ |

---

## Razorpay Reconciliation

- `settlement_sync` scheduler — 24h interval (code)
- Admin `POST /api/admin/finance/settlement-sync` — finance smoke **200**
- **Live Razorpay API reconciliation:** NOT EXECUTED (no keys)

---

## Webhook Security

- Route: `POST /api/payments/webhook`
- Pentest script: `webhook replay` among 16 findings — **0 vulnerable, 4 notVerified**
- Without `RAZORPAY_WEBHOOK_SECRET`, replay test inconclusive

---

## Issues

### ISSUE-PAY-001 — Razorpay not configured
- **Severity:** CRITICAL (for production payments)
- **Root cause:** Missing `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- **Impact:** No real money movement; staging/prod payments blocked
- **Fix:** Configure secrets; run `k6:payment` load test against staging
- **Confidence:** HIGH

### ISSUE-PAY-002 — Webhook path unverified
- **Severity:** HIGH
- **Impact:** Payment confirmation relies on dev/mock mode only
- **Fix:** Configure webhook secret; send test payloads; verify idempotency + ledger
- **Confidence:** HIGH

### ISSUE-PAY-003 — Membership cashback settlement broken in smoke
- **Severity:** MEDIUM
- **Root cause:** `cashbackService.settleOnPayment` undefined
- **Impact:** Premium payment → cashback chain untested
- **Fix:** Repair cashback service export
- **Confidence:** HIGH

---

## Payment Score: 60/100

Strong ledger/test harness in dev; live gateway path unproven.
