# Dispatch Bypass Forensic Inventory — Phase 3A

**Revision:** Phase 3 production hardening  
**Scope:** Every path capable of creating partner assignment/offer or bypassing dispatch eligibility  
**Authoritative gate:** `partnerOperationsService.assertOfferEligible()` (final revalidation)

---

## Summary

| Path | Caller | Can assign? | Existing gates (pre-Phase-3) | Missing gates (pre-Phase-3) | Decision (Phase 3) |
|------|--------|-------------|------------------------------|----------------------------|-------------------|
| **Matching → assignment engine** | `assignment-engine.service.ts` → `dispatchToNextProvider` | Offer (SENT attempt) | Matching filters stale; `assertOfferEligible` in tx | None | **KEEP** — authoritative path |
| **Direct booking + `providerId`** | `booking.service.ts` → `create()` | Sets `booking.providerId` at create | `validateProvider` (active/approved/skill only) | Lifecycle ACTIVE, presence fresh, location fresh, capacity, geo final lock | **CLOSED** — `assertOfferEligible` inside create tx |
| **Admin reassign** | `admin-booking-operations.service.ts` → `reassignProvider` | Sets `providerId` + ASSIGNED | Payment gate; admin auth (route) | Full dispatch eligibility | **CLOSED** — `assertOfferEligible` in tx; emergency override for presence/location only |
| **Admin force dispatch** | `admin-booking-operations.service.ts` → `forceDispatch` | Offer via engine | Routes to `dispatchBookingNow` → engine | None (uses engine path) | **KEEP** — already gated |
| **Admin repair (dispatch branch)** | `admin-booking-operations.service.ts` → `repairBooking` | May call `dispatchBookingNow` | Engine path when dispatching | Repair-from-attempt copies prior `providerId` without revalidation | **ACCEPT** — attempt was validated at offer time; dispatch branch uses engine |
| **Admin repair (attempt copy)** | `repairBooking` ACCEPTED + no providerId | Copies `attempt.providerId` | Prior offer was gated | Stale between offer and repair | **LOW RISK** — repair is ops recovery; partner already had SENT attempt |
| **Partner accept** | `booking.service.ts` → `accept()` | Claims booking | `assertAcceptEligible` (incl. stale presence) | N/A | **KEEP** |
| **Booking cancel/reject** | Various | No new assignment | N/A | N/A | **N/A** |
| **Automation / webhooks** | No direct assignment writers found | — | — | — | **CLEAN** |
| **Test fixtures** | `assignmentAttempt.create` in tests | Test-only | N/A | N/A | **TEST ONLY** |

---

## Path Details

### 1. Assignment engine (authoritative offer creation)

- **File:** `apps/backend/src/services/assignment-engine.service.ts`
- **Entry:** `dispatchToNextProvider` → `assignmentAttempt.create`
- **Gate:** `assertOfferEligible(tx, providerId, job)` immediately before offer write
- **Metric:** `final_revalidation_failures{reason}` on block

### 2. Direct booking with providerId

- **File:** `apps/backend/src/services/booking.service.ts`
- **API:** Customer booking create with optional `providerId`
- **Pre-Phase-3 bypass:** Created booking with provider assigned without presence/location freshness
- **Phase-3 fix:** `assertOfferEligible` inside Serializable tx before `booking.create`
- **Reject mapping:** `DIRECT_ASSIGN_BLOCKED:*` → customer `PROVIDER_UNAVAILABLE`
- **Metric:** `direct_assignment_rejections{reason}`

### 3. Admin reassign

- **File:** `apps/backend/src/services/admin-booking-operations.service.ts` → `reassignProvider`
- **API:** `POST /admin/bookings/:id/reassign`
- **Pre-Phase-3 bypass:** Direct `booking.update({ providerId, status: ASSIGNED })`
- **Phase-3 fix:** Transaction + `assertOfferEligible`; reject with `REASSIGN_BLOCKED:{code}`
- **Emergency override:** Optional body `emergencyOverride` — bypasses **presence/location only**; requires audited `DISPATCH_ELIGIBILITY_OVERRIDE` action
- **Never overridable:** SUSPENDED, OFFLINE, PAUSED, capacity, geo, schedule
- **Metric:** `admin_reassignment_rejections{reason}`

### 4. Admin force dispatch / repair dispatch

- **Routes through:** `assignmentEngine.dispatchBookingNow` → same engine path as matching
- **Gate:** Inherited from assignment engine

---

## Four-Axis Compliance

- Stale presence → dispatch block only; **does not** mutate Partner lifecycle, Job, or Money
- `assertOfferEligible` reads presence evidence; never writes Partner/Job/Money axes
- Emergency override is explicit + audited; not a silent backdoor

---

## Phase 3 Closure Loop Re-scan (2026-09-07)

**Revision:** `104a3f77402eb3ad541a56336dcc61b04d04ce63`

| Path | Creates assignment/offer? | `assertOfferEligible`? |
|------|----------------------------|------------------------|
| `booking.service.ts` create with `providerId` | Yes | **YES** |
| `admin-booking-operations.service.ts` reassignProvider | Yes | **YES** (+ governed override) |
| `assignment-engine.service.ts` dispatchToNextProvider | Yes | **YES** |
| `booking.service.ts` accept / claim | Claims offer | `assertAcceptEligible` |
| Test `assignmentAttempt.create` | Test only | N/A |

**Emergency override security (Phase 3F):**

- Tampered `emergencyOverride.adminId` ≠ acting admin → **REJECT** (test proven)
- Override on `SUSPENDED` lifecycle → **REJECT** (test proven)
- No hidden endpoint for override without admin route auth

**No new hidden production bypass found.**
