# ADR-007: Payment Financial Atomicity

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Payments / Backend Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

HOMIGO payment flows integrate with Razorpay for order creation, payment verification, webhook settlement, and wallet ledger updates. Financial operations require atomic state transitions: a verified payment must produce exactly one settlement, one ledger entry, and one `homigo.payment.success` outbox event.

Step 12 certification executed controlled success and failure paths on staging with Razorpay TEST credentials only.

---

## Problem

Payment systems fail expensively when:

1. Duplicate webhook delivery creates double settlement.
2. Partial failure leaves payment `COMPLETED` without ledger entry or vice versa.
3. Live credentials are used in non-production environments.
4. Amount reconciliation drifts between order, payment record, and ledger (paise precision).

---

## Decision

Implement **financial atomicity** through:

### Razorpay integration (staging certified)

| Control | Implementation |
|---------|----------------|
| Mode gate | TEST keys only (`rzp_test_*`); `RAZORPAY_LIVE_USED = NO` all stages |
| Order create | Real Razorpay TEST order on staging |
| Verify | Server-side signature validation |
| Webhook | HMAC validation; duplicate webhook dedup |
| Idempotent verify | `alreadySettled` on duplicate verify attempt |

### Ledger and wallet

- Wallet settlement transitions to `COMPLETED` atomically with payment record update.
- Amount reconciliation verified in `step-12-amount-reconciliation.json`.
- Financial atomicity evidence in `step-12-financial-atomicity.json`.
- Wave-1 schema: `wallet_transfers`, `wallet_balance_paise` columns (clean replay 31/31).

### Event emission

- Successful payment emits `homigo.payment.success` via transactional outbox (ADR-001).
- Consumer receipts prevent duplicate downstream effects (ADR-006).

### Failure path

- Failed payment certified separately (`FAILED_PAYMENT_ID` in Step 12).
- Failure does not produce success event or completed ledger state.

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Client-side payment confirmation only** | No server authority; webhook required |
| **Event-first (publish before DB commit)** | Violates ADR-001 atomicity |
| **Separate payment microservice** | Phase 0 certifies monolith path @ c31f154 |
| **Float amounts (rupees only)** | Paise columns required for precision |
| **Manual settlement reconciliation** | Not scalable; automated ledger required |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| End-to-end certified TEST flow | Production Razorpay LIVE not certified in Phase 0 |
| Webhook dedup + verify idempotency | Webhook secret rotation requires coordinated deploy |
| Paise-precision schema | Migration complexity (Wave-1 remediation) |
| Outbox-backed payment events | Eventual notification of downstream systems |

---

## Consequences

**Positive:**
- Step 12: PASS — 0 critical failures; success + failure paths certified.
- Stage D Razorpay gates: 12/12 PASS.
- Stage G: PAYMENT_EXECUTED=true, PAYMENT_SUCCEEDED=true, DUPLICATE_PAYMENT_EFFECTS=0.

**Negative:**
- Production LIVE credentials and production webhook endpoints not runtime-tested.
- Staging uses TEST mode; production promotion requires separate secret provisioning (ADR-012).

**Operational:**
- Secrets: `STAGING_RAZORPAY_KEY_ID`, `STAGING_RAZORPAY_KEY_SECRET`, `STAGING_RAZORPAY_WEBHOOK_SECRET` @ v3.

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 12 certification | `docs/evidence/stage-d-step-12/step-12-payment-certification.md` |
| Financial atomicity | `docs/evidence/stage-d-step-12/step-12-financial-atomicity.json` |
| Webhook idempotency | `docs/evidence/stage-d-step-12/step-12-webhook-idempotency.json` |
| Amount reconciliation | `docs/evidence/stage-d-step-12/step-12-amount-reconciliation.json` |
| Stage D Razorpay gates | `docs/evidence/stage-d/stage-d-razorpay-gates-20260804T105808Z.json` |
| Stage G payment safety | `docs/evidence/stage-g-soak/stage-g-payment-safety.json` |
| Wave-1 wallet schema | `docs/evidence/stage-d/step-d-wave1-clean-replay-certification.md` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Production Razorpay LIVE certification | Pre-prod | Separate cert cycle with LIVE keys |
| Chargeback / refund event flows | Payments phase | Not Phase 0 scope |
| PCI scope documentation | Compliance | Razorpay-hosted card data |

---

## Related ADRs

ADR-001 (Transactional Outbox) · ADR-002 (Event Driven Architecture) · ADR-006 (Idempotency) · ADR-012 (Production Promotion)
