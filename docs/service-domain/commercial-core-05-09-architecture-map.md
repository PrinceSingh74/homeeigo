# Commercial Core 05–09: architecture map (Phase 00 baseline audit, 2026-09-22)

Evidence base: four read-only code audits (booking lifecycle; payments/refunds/wallet; eligibility/serviceability; availability/capacity/events) plus live measurement of `homigo_db`. File references are relative to `apps/backend`. No code was changed to produce this map.

## 0. Live baseline (measured, not assumed)

| Fact | Value |
|---|---|
| Live services / fixture services | 31 / 35 |
| Phase 06 active items / assignments | **69 / 149**. The brief said 70/150; v2 archived one item and removed one line. |
| Readiness | 25 READY · 1 READY_WITH_INSPECTION · 4 COMMERCIAL_HOLD · 1 SAFETY_HOLD · 0 invalid |
| Bookings / payments / refund requests / ledger entries / wallet txns | 707 / 421 / 339 / 2303 / 56 |
| Migrations applied | 133 |

## 1. Domain boundaries (ownership, enforced from here on)

| Phase | Owns | Must never |
|---|---|---|
| 05 | price, tax, fees, discounts, signed quote, payment amount authority | — (frozen) |
| 06 | materials, equipment, preconditions, attestations, requirement snapshot | — (frozen) |
| 07 | who may book (eligibility) · where we serve (serviceability) | compute price, time or capacity |
| 08 | when: lead time, advance window, blackout, hours, slot, capacity | compute price or eligibility |
| 09 | booking commit, payment settlement, cancel, reschedule, refund, matching handoff | invent price, refund %, or policy |
| 11 | provider matching | (consumed via handoff; not rebuilt) |

## 2. Map: EXISTING → REUSE / EXTEND / DUPLICATE / MISSING / DEPRECATED / CONFLICT

### Booking pipeline (`booking.service.ts create()` :122-590)

| Element | Status | Note |
|---|---|---|
| Quote verification order (sig/expiry → uid/sid/fingerprint → pricing version → service version → amount) | **REUSE** | Phase 05, frozen |
| Requirement attestation → `REQUIREMENTS_NOT_CONFIRMED` | **REUSE** | Phase 06, frozen |
| `serviceConfigSnapshot` (config + requirements + pricing) | **EXTEND** | add eligibility, serviceability, slot/timezone and structured policy snapshots |
| Transaction: ReadCommitted + advisory lock + `FOR UPDATE` overlap scans + GiST exclusion | **REUSE** | DB-native race guard; never replace with app-only checks |
| Idempotency: global optional `Idempotency-Key` header, Redis/memory, **not bound to path or body** | **EXTEND** | bind to actor + operation + request fingerprint |
| Checks outside the transaction (`validateBooking`) all collapse to `VALIDATION_ERROR` | **CONFLICT** | a lead-time failure reads "Invalid service or address…" |
| Quote token optional (no-token bookings allowed, counted) | EXISTING | policy decision, left as is |

### Phase 07: eligibility and serviceability

| Element | Status | Note |
|---|---|---|
| Account active / not banned / not deleted → 403 `ACCOUNT_SUSPENDED` (auth plugin) | **REUSE** | the only hard customer gate |
| Email verified at create → 403 `EMAIL_NOT_VERIFIED` (not at quote) | **REUSE** | |
| Premium-only → 403 `UPGRADE_REQUIRED` (in quote) | **REUSE** | |
| Audience: server-checked but **self-declared** (never compared with profile) | **EXTEND** | only as far as existing data allows; no gender or age inference |
| `ageMin/ageMax`, `propertyTypes`, `eligibility` text, `audienceRules` | **MISSING (configured, never enforced)** | owner decision: which ones, from which verified data |
| Risk/abuse block at booking | **MISSING** | owner decision |
| Coverage: `availableCities` + `catalog_config.coverage.{cityIds,pincodes}` via `coverageAllowsAddress` (empty = unspecified) | **REUSE** | enforced at create only |
| Serviceability at **quote** | **MISSING** | the customer learns only at create |
| `coverage.zoneIds`, `radiusKm`, `serviceabilityRequired`, `unavailableCities`, city COMING_SOON overrides | **MISSING (configured, never enforced)** | |
| Three coverage truths (service lists · hyperlocal seed + city overrides · geofences) | **CONFLICT** | booking uses only the first; unify only on owner direction |
| Catalogue list/search `availableCities: { has: city }`: case-sensitive, hides empty lists | **CONFLICT** | opposite of booking's "empty = everywhere" |
| PostGIS | NOT PRESENT | haversine on Floats; ST_DWithin unavailable without an approved extension |
| Address lat/lng `?? 0` fallback at create | **CONFLICT** | violates "unknown GPS = null" |

### Phase 08: availability, capacity, slot

| Element | Status | Note |
|---|---|---|
| D1 trigger `[start−30, start+slot_duration+30)`, half-open GiST exclusions, partial unique indexes | **REUSE** | the single occupancy authority |
| `resolveServiceDuration` (single) → `slotDurationFor` | **REUSE** | Phase 05 duration authority |
| `minimumLeadTimeMinutes`, `maximumAdvanceDays`, `sameDay`, `blackoutDates` | **EXTEND** | enforced, but with defects (below) |
| Hard 30-day cap overrides `maximumAdvanceDays` (1–365 allowed) | **CONFLICT/DEFECT** | configured > 30 is silently ignored |
| Same-day uses server-local date; blackout uses UTC date; advance uses local `setDate` | **DEFECT** | inconsistent civil-date semantics; the business is IST (`Asia/Kolkata` default everywhere) |
| Provider working-window check tests the **start instant only** | **DEFECT** | a slot running past closing time passes |
| Business/operating hours for services | **MISSING** | web/mobile hard-code 6 times (09–19); owner decision |
| Server-side slot generation / customer slots API | **MISSING** | `/book` claims "Fastest available slot secured" with no check behind it |
| `instant`, `scheduled`, `recurring`, `slotBufferMinutes`, `paymentRequiredBeforeDispatch` | **DEPRECATED-IN-PRACTICE** | declared, never read |
| Provider capacity (`maxConcurrentJobs`, `maxJobsPerDay`, breaks, timezone) | **REUSE** | workload cap, evaluated "now" only |
| Matching conflict window ±2 h score penalty (not the D1 slot); online-now filter for future jobs | **CONFLICT** | Phase 11: expose a capacity query, do not rebuild |
| Slot cache | NOT PRESENT | none needed yet |

### Phase 09: booking lifecycle

| Element | Status | Note |
|---|---|---|
| `booking-state-machine.ts` table | **EXTEND** | only `start`/`complete` consult it; other writers hard-code guards |
| Status history trigger (append-only, actor via `set_config`) | **REUSE** | |
| Cancel: single `bookingService.cancel`, CAS, async refund | **REUSE** | |
| Cancellation policy: hard-coded tiers (>24 h 100%, 2–24 h 90%, <2 h 75%, in-progress 50%, provider/admin-full 100%) | **CONFLICT** | live constants override the booking's snapshot; tier ids disagree (`late` vs `very_late`) |
| Snapshot `cancellationPolicy`/`reschedulePolicy` free text, never read | **CONFLICT** | policy changes apply retroactively |
| Customer reschedule: overlap check only | **DEFECT** | skips lead time, blackout, advance, past date, coverage, working hours |
| Admin reschedule: **no status guard**, no audit actor | **DEFECT** | a COMPLETED or cancelled booking can be rescheduled |
| No-show / late arrival / customer absent | **MISSING** | free-text catalog fields only; owner policy |
| Dispatch job created pre-payment, fan-out payment-gated | **REUSE** | the matching handoff exists |

### Phase 09: payment, refund, wallet, ledger

| Element | Status | Note |
|---|---|---|
| Order amount from `booking.finalAmount` only; client amount ignored and logged | **REUSE** | |
| Placeholder reservation + CAS on order create | **REUSE** | |
| Split verify-bypass guard (verify and webhook route to `settleSplitCapture`) | **REUSE** | tested |
| Webhook raw-body HMAC + `WebhookEventDedup` | **EXTEND** | find-then-create race (no P2002 handling) |
| "Payment never writes booking status" | **VERIFIED** | |
| Refund orchestrator (reserve in tx → gateway with idempotency header → INDETERMINATE) + ceiling | **REUSE** | the single refund authority |
| **D1 gift-card void: gateway refund AND wallet credit for the same money** | **DEFECT P1 (confirmed)** | no idempotency, no refund request, wallet credit unjournaled, paise = 0 |
| **D2 split payment retried after failure charges the wallet share twice** | **DEFECT** | retry sets the gateway amount to the full total but keeps `walletAmount` |
| **D3 late capture on a replaced order is lost** | **DEFECT** | webhook matches the current `razorpayOrderId` only |
| **D4 out-of-order `refund.processed` double-counts `refundedAmount`** | **DEFECT** | shrinks the refundable ceiling; no money moves |
| Abandoned INITIATED payments: no expiry, no booking-payment reconciliation | **MISSING** | recovery is engineering; the TTL is owner policy |
| Payment attempt model (booking ↔ payment is 1:1) | EXISTING | retries reuse the row; D2/D3 come from this. Keep 1:1; fix the retry. |
| Events: `booking.created/assigned/started/completed/cancelled`, `payment.success/failed`, `checkout.started` | **EXTEND** | missing refund, rescheduled, slot-released events |

## 3. Owner decisions (not invented; recorded as blockers)

| # | Decision | Blocks |
|---|---|---|
| O1 | Service business hours / slot grid (today: client-side list 09:00–19:00, 2 h steps) | server slot generation beyond a projection of the existing list |
| O2 | Pending-payment expiry TTL and hold semantics | automatic slot release on abandoned checkout |
| O3 | No-show, late-arrival, customer-absent policy and financial effect | those states |
| O4 | Eligibility dimensions to enforce (age, property type, risk) and the verified data source | Phase 07 eligibility beyond the existing gates |
| O5 | One coverage truth (service lists vs hyperlocal/override vs geofences); zones/radius | Phase 07 serviceability beyond city/pincode |
| O6 | Reschedule policy (cutoff, count, fee, repricing) | reschedule rules beyond "must satisfy the same availability rules as a new booking" |
| O7 | Refund routing beyond "refund to original tender" (gift card, mixed) | — (existing tender rule applied) |
| O8 | Phase 06 commercial chain (parts price authority, …) | the 4 COMMERCIAL_HOLD services |

## 4. Build order (risk first; each wave tested, proven by reintroduction, regression-green before the next)

1. **Wave 1: money defects D1–D4 and the webhook dedup race.** Engineering only. The fixes apply the platform's existing rules, e.g. refund to original tender, the ceiling, and idempotency.
2. **Wave 2: Phase 07/08 correctness.**
   - one business-timezone civil-date helper
   - the configured advance window honoured
   - the working window covers the whole slot
   - a stable reason-code taxonomy instead of `VALIDATION_ERROR`
   - serviceability surfaced at quote
   - reschedule held to new-booking availability rules
   - admin reschedule status guard
   - the unbacked "slot secured" copy removed
3. **Wave 3: Phase 09 contracts.**
   - bound idempotency for booking create
   - structured, versioned policy snapshot read by cancellation (existing tiers, fixed ids)
   - eligibility, serviceability and slot snapshots
   - refund, reschedule and slot-released events on the existing outbox
   - booking-payment reconciliation for missed webhooks
4. **Wave 4: availability API.** A server projection of the existing slot list evaluated against lead time, advance, blackout, overlap and qualified-provider capacity. Gated by O1 for anything beyond it.
5. **Certification:** full regression, migration parity, browser, reintroduction matrix, report.
