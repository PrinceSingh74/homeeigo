# HOMEEIGO Dispatch Eligibility — Phase 2 Certification

**Date:** 2026-09-07  
**Prerequisite:** [HOMEEIGO_PRESENCE_FOUNDATION_CERTIFICATION.md](./HOMEEIGO_PRESENCE_FOUNDATION_CERTIFICATION.md)

---

## Completion Gate

| Gate | Status | Evidence |
|------|--------|----------|
| Matching inventory complete | ✅ | `docs/DISPATCH_ELIGIBILITY_BASELINE.md` |
| Eligibility engine implemented | ✅ | `dispatch-eligibility.service.ts` → `evaluateDispatchEligibility()` |
| ACTIVE gate enforced | ✅ | `isDispatchEligibleLifecycle()` in evaluate + assertOfferEligible |
| AVAILABLE gate enforced | ✅ | `isOnline && !pausedAt` |
| Presence gate enforced | ✅ | `isPresenceFresh()` — matching + final revalidation |
| Location gate enforced | ✅ | `isLocationFresh()` + coord validation |
| Capacity/schedule/geo preserved | ✅ | Existing assertOfferEligible logic retained |
| Final revalidation implemented | ✅ | assertOfferEligible before assignmentAttempt.create |
| Atomic reservation verified | ✅ | Existing FOR UPDATE + SENT attempts unchanged |
| Race tests | ✅ | Stale presence blocked at offer tx (integration test) |
| Negative cases | ✅ | Unit matrix: offline, stale presence/location, APPLIED, SUSPENDED |
| APPLIED + isApproved blocked | ✅ | Returns `ACCOUNT_RESTRICTED` at offer gate |
| Zone supply confidence | ✅ | `deriveZoneSupplyConfidence()` deterministic rules |
| Security | ✅ | Server-derived only; no client dispatchEligible |
| Events | ✅ | Types + builders for presence/location/eligibility changed |
| Observability | ✅ | `dispatch_eligibility_pass/reject_total` metrics |
| Load tests | ⏳ | Staging baseline — service layer ready |
| Correlated E2E | ⏳ | Existing e2e + new unit/integration tests |
| Four-axis non-contamination | ✅ | Stale presence does not mutate lifecycle/job/money |
| Phase 1 regression | ⏳ | Run `partner-presence.*.test.ts` in CI |
| No P0/P1 | ✅ | None identified in implementation pass |

---

## Authoritative Formula

```
DISPATCH ELIGIBLE =
  lifecycle ACTIVE
  AND isApproved
  AND isOnline AND NOT paused
  AND presence FRESH (Postgres PartnerPresence.lastHeartbeatAt)
  AND location FRESH (PartnerPresence.lastLocationAt + valid coords)
  AND schedule OK
  AND geo OK
  AND capacity OK
  AND (existing business gates)
```

**Presence is an eligibility gate — not a ranking score.**

---

## Structured Decision Example

```json
{
  "eligible": false,
  "reasons": ["STALE_PRESENCE"],
  "checks": {
    "lifecycle": true,
    "availability": true,
    "presence": false,
    "location": true,
    "capacity": true,
    "schedule": true,
    "geo": true,
    "skill": true,
    "risk": true,
    "payment": true,
    "conflict": true
  }
}
```

---

## Redis Failure Policy

Dispatch eligibility reads **Postgres only**. Redis unavailability does not grant dispatch pass. Fail-safe: no fresh durable heartbeat → not eligible for **new** offers.

---

## Customer-Facing Supply Labels

| Confidence | Label |
|------------|-------|
| HIGH (≥3 fresh) | Available now |
| MEDIUM (≥1 fresh) | Limited availability |
| LOW (online but stale telemetry) | Confirming professional |
| NONE | Unavailable |

Internal reason codes are **not** exposed to customers.

---

## Test Commands

```bash
cd apps/backend
NODE_ENV=test bun test src/__tests__/dispatch-eligibility.test.ts
NODE_ENV=test bun test src/__tests__/partner-presence.unit.test.ts
NODE_ENV=test bun test src/__tests__/partner-presence.integration.test.ts
NODE_ENV=test bun test src/__tests__/partner-four-axis-orthogonality.test.ts
NODE_ENV=test bun test src/__tests__/partner-operations.integration.test.ts
```

---

## Non-Goals (Confirmed Not Built)

- No fifth Presence FSM
- No Availability/Job/Finance FSM changes
- No auto-SUSPEND on stale presence
- No job cancel on stale heartbeat
- No money mutation on presence failure

---

## Phase 3+ Hardening (Out of Scope)

- Align direct-booking validation with full eligibility
- Admin reassign presence gate
- Emit `partner.dispatch_eligibility.changed` on transitions (builders ready)

**Certified:** Phase 2 implementation pass — 2026-09-07
