# Dispatch Eligibility Baseline — Phase 2A Forensic Audit

**Date:** 2026-09-07  
**Prerequisite:** Phase 1 Presence Foundation complete

---

## Executive Summary

Dispatch eligibility was **split across four layers** before Phase 2:

| Layer | Authority | Gap before Phase 2 |
|-------|-----------|-------------------|
| `matching.service.loadCandidates` | SQL WHERE | No presence/location freshness |
| `matching.scoreProvider` | Soft availability score | Stale GPS still scored |
| `assertOfferEligible` | **Final offer gate** (FOR UPDATE) | No presence/location |
| `assertAcceptEligible` | Accept gate | No presence |

Phase 2 adds **`evaluateDispatchEligibility()`** as the single decision function and wires presence/location gates into matching + final revalidation.

---

## Canonical Dispatch Flow

```
Customer booking (PENDING, no providerId)
  → assignmentEngine.createJob()
  → dispatchBookingNowBackground()
      → dispatchToNextProvider()
          → matchingService.findBestProviders()     [candidate + rank]
          → FOR EACH candidate:
              → prisma.$transaction
                  → assertOfferEligible()           [FINAL REVALIDATION]
                  → assignmentAttempt.create(SENT)  [OFFER]

Partner accept
  → bookingService.accept() [Serializable]
      → assertAcceptEligible()
      → assertBookingConflictFree()
      → payment gate
```

Cron: `maintenance.ts` → `runAssignmentDispatch()` every ~30s (Redis lock `assignment:processor`).

---

## Current Eligibility Rules (Pre-Phase-2 + Phase-2 Additions)

### Matching SQL (`loadCandidates`)

- Service category match
- `isActive`, `isApproved`, `!isBanned`, `!complianceRestricted`
- `pausedAt: null`, `lifecycleState: ACTIVE`
- `isOnline: true`
- **Phase 2:** post-filter `passesPresenceLocationGate()` (Postgres `PartnerPresence`)

### Availability score (matching)

- Online, not paused, capacity, schedule, break, radius, zones, conflict penalty

### Final revalidation (`assertOfferEligible`)

| Gate | Code |
|------|------|
| Lifecycle ACTIVE | `ACCOUNT_RESTRICTED` |
| Approved | `APPROVAL_PENDING` |
| Online | `OFFLINE` |
| Not paused | `PAUSED` |
| **Presence FRESH** | **`STALE_PRESENCE`** |
| **Location FRESH + valid coords** | **`STALE_LOCATION` / `LOCATION_INVALID`** |
| Working hours / break | `OUTSIDE_WORKING_HOURS` / `BREAK_ACTIVE` |
| Service area | `OUTSIDE_SERVICE_AREA` |
| Capacity | `CAPACITY_LIMIT` |

### Accept (`assertAcceptEligible`)

- Online, not paused, capacity
- **Phase 2:** presence FRESH (`STALE_PRESENCE`)

---

## Integration Points

| Consumer | Phase 2 change |
|----------|----------------|
| `matching.service.ts` | Batch-load presence; filter stale before rank |
| `partner-operations.service.ts` | `assertOfferEligible` + `assertAcceptEligible` presence gates |
| `dispatch-eligibility.service.ts` | **New** authoritative `evaluateDispatchEligibility()` |
| `assignment-engine.service.ts` | Unchanged call path — inherits via `assertOfferEligible` |

---

## Bypass Paths (unchanged — document for Phase 2+ hardening)

| Path | Risk |
|------|------|
| Direct booking (`body.providerId`) | Weaker validation — no presence gate |
| Admin reassign | Skips matching + offer eligibility |
| `providerService.search` | Weaker filters — not dispatch path |

---

## Redis Failure Policy (Phase 2M)

**Dispatch uses Postgres `PartnerPresence` only** — not Redis TTL.

- Missing row → fail closed (`STALE_PRESENCE`)
- Stale heartbeat → fail closed
- Redis down → **no impact** on dispatch eligibility (durable evidence)

Existing in-flight jobs continue under job recovery rules; presence stale does **not** cancel jobs or mutate lifecycle/money.

---

## Race: Matcher → Stale Heartbeat → Offer

```
T0  Partner ACTIVE, AVAILABLE, presence FRESH
T1  Matcher selects partner
T2  Heartbeat expires
T3  dispatchToNextProvider → assertOfferEligible (FOR UPDATE)
T4  REJECT STALE_PRESENCE — no offer created
```

Capacity reservation via SENT `assignmentAttempt` rows unchanged.

---

## Duplicate Logic Map

| Before | After Phase 2 |
|--------|---------------|
| 4-way eligibility split | `evaluateDispatchEligibility()` single pure function |
| Matching vs offer divergence on GPS | Both use same freshness thresholds (Phase 1 config) |
| `isDispatchEligibleStatus()` unused | Still unused — availability = isOnline + !paused for dispatch |

---

## Files

| Path | Role |
|------|------|
| `services/dispatch-eligibility.service.ts` | Authoritative engine |
| `lib/dispatch-eligibility.types.ts` | Structured decision types |
| `services/matching.service.ts` | Candidate presence filter |
| `services/partner-operations.service.ts` | Final revalidation |
| `services/assignment-engine.service.ts` | Offer creation |
| `lib/partner-presence-freshness.ts` | Canonical freshness (no duplication) |
