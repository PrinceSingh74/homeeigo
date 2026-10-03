# Commercial Core — Phase 09: booking, payment and cancellation contracts

Status: implemented (Wave 3). Extends Phase 05 (money) and Phase 06 (requirements) without replacing
either; both remain their own authorities. Phase 07/08 (schedule and serviceability) is unchanged by
this work — see `commercial-core-phase-07-08-schedule-rules.md`.

---

## 1. What was wrong before

| # | Defect | Where | Effect |
|---|---|---|---|
| P1 | Booking create had **no idempotency of any kind** | `routes/bookings.ts`, `booking.service.create` | A customer whose connection dropped after the request reached the server had no safe way to retry. A retry created a second booking, at a second charge. |
| P2 | Cancellation always applied the **live** policy constants | `cancellation-policy.service.calculate` | Editing the published policy silently re-priced the refund of every booking ever placed, including bookings sold under different terms. |
| P3 | The published tier id and the charged tier id **disagreed** | same | The policy publishes `late` for the under-2-hours window; `calculate` returned `very_late`. Amounts agreed (25% / 75%), so no money was wrong, but no client could match the tier it was given against the tier list it was shown. |
| P4 | No `booking.rescheduled` event existed | `events/catalog` | A schedule change reached no consumer. The gap was already load-bearing: the AI tool catalogue declares `eventMapping: "homigo.booking.rescheduled"` for `write.booking.rescheduleBooking` — an event nothing emitted. |
| P5 | Missed-webhook reconciliation covered gift cards and subscriptions but **not booking payments** | `payment.service.reconcilePendingOrders` | A booking whose `payment.captured` webhook never arrived stayed unpaid with the customer charged, and nothing ever noticed. |
| P6 | The booking recorded its price and its requirements, but not the **terms** or the **schedule decision** | `booking.service.create` | Nothing said which policy or which availability rules admitted the booking, so the answer to "why was this allowed, and on what terms?" was whatever the constants happened to say later. |

## 2. Idempotent booking create

`Idempotency-Key` on `POST /api/bookings`. Optional: **a request without one behaves exactly as it
does today.** Dedupe is never inferred from the body — "same fields within N seconds" would refuse a
customer legitimately booking the same service twice.

| Situation | Answer |
|---|---|
| First use of the key | booking created, `201` |
| Same key, same request | the SAME booking, `200`, `replayed: true`, header `Idempotent-Replayed: true` |
| Same key, **different** request | `409 IDEMPOTENCY_KEY_REUSED`, nothing created |
| Same key while the first is still running | `409 IDEMPOTENCY_IN_PROGRESS` + `Retry-After` — the code the deployed mobile offline queue already treats as retryable |
| Key malformed (not 8–128 printable non-space chars) | `400 INVALID_IDEMPOTENCY_KEY` |
| The request fails | the key is **released**, so a corrected retry is a first attempt |
| The key's booking was deleted | `409 IDEMPOTENCY_KEY_REUSED` — never a phantom replay |

The arbiter is the unique index on `(user_id, key)` — the same mechanism the platform already trusts
for journal entries and webhook dedup — claimed with `INSERT … ON CONFLICT DO NOTHING … RETURNING`.
A read-then-write would let two retries both see "no record" and both proceed.

**Bounded**, so this cannot become an unbounded record of everything anyone ever sent: every row has
`expires_at` (24h); an expired row is reclaimed by the next request that uses the key; and the
maintenance tick sweeps the rest, on the same leader lock as the existing OTP cleanup.

Migration `20260923100000_booking_idempotency_keys` is additive: one new table, no change to any
existing table, column, index, constraint, trigger or row, and nothing seeded.

## 3. The policy a booking was sold under

The cancellation policy is now **versioned data** (`CANCELLATION_POLICY`, `cancellation.v1`) rather
than numbers inlined in a function: each tier carries its threshold, its boundary, its percentages
and its customer sentence. A booking freezes a copy at creation under
`serviceConfigSnapshot.policy.cancellation`, and both the customer-facing quote and the actual
cancellation are computed from that copy.

Boundaries were transcribed exactly, not normalised — the original comparisons were `> 24` and
`>= 2`, so `boundary: "exclusive" | "inclusive"` is recorded per tier. Normalising them would have
moved real money at the boundary.

A snapshot is **validated, not trusted**: a policy that is missing, malformed, or left with no time
tier after validation returns null and the caller falls back to the current published policy — the
only honest answer for a row that never recorded one (every booking made before this existed).

`late` is now the id everywhere. `very_late` is retained in the type as deprecated and is never
returned; nothing persists a tier id, so aligning them changed no money and no history.

## 4. Snapshots

`serviceConfigSnapshot` already carried `pricing` (Phase 05) and `requirements` (Phase 06). It now
also carries:

- `policy.cancellation` — the terms above;
- `schedule` — timezone, the appointment, `slotDurationMinutes`, the lead time, advance window,
  same-day rule and blackout dates **as they stood when the booking was admitted**.

No schema change: these extend the existing JSON column, the same way Phases 05 and 06 did.

## 5. `homigo.booking.rescheduled`

Emitted with `emitInTransaction` from both reschedule paths (customer and admin), carrying
`previousScheduledAt` and `scheduledAt` and the actor. In the same transaction as the write, so a
consumer can never see a move that rolled back, nor miss one that committed — asserted by a test that
makes the reschedule conflict and checks the outbox is empty.

## 6. Missed-webhook reconciliation for booking payments

`reconcilePendingBookingPayments` scans booking payments that still hold a real gateway order and
have been untouched for at least 10 minutes, asks the gateway what it holds, and hands any capture to
**`reconcileFromWebhook`** — the same path the webhook takes, with the same `ALREADY_RECONCILED`
idempotency, the same split handling and the same ledger journal. Nothing is settled on this
method's own authority; the gateway's answer is the evidence and the webhook path is the arbiter.

Deliberately not done:

- an order the gateway reports as **unpaid is left alone**. Expiring it is owner decision **O2**
  (pending-payment TTL), not something to infer here;
- payments younger than the threshold are left to the webhook;
- with no gateway configured the sweep does nothing rather than guessing;
- a gateway error is counted and logged as an error, never silently treated as "unpaid".

It also takes an optional `{ paymentId }` scope, so support can reconcile one booking on demand.

## 6b. PAYMENT_PENDING_TTL — 15 minutes (owner decision 2026-09-23)

An unpaid booking used to hold a partner's slot for ever. On the live database at the time of writing
that is **85** bookings PENDING/PENDING and **35** PENDING/INITIATED — every one occupying a window
nobody else can book.

**The transition.** A PENDING booking whose payment has not settled within 15 minutes becomes
`BookingStatus.EXPIRED` + `PaymentStatus.EXPIRED`, its payment rows become EXPIRED, and
`homigo.booking.payment_expired` is written to the outbox **in the same transaction**.

**Capacity release needs no new code.** `bookings_sync_conflict_slots` already nulls `user_slot_*`
and `provider_slot_*` for any status outside the active set, and the GiST exclusion constraints only
bind where those columns are set. Moving the booking to EXPIRED frees the slot through the mechanism
that already owns slots — proven by a test that books the freed slot immediately afterwards.

**Why new enum values.** An expired booking is not `CANCELLED_BY_USER` (the customer cancelled
nothing, and that status feeds cancellation-rate reporting), not `CANCELLED_BY_PROVIDER` (that status
feeds **partner reliability scoring** — reusing it would penalise a partner for a customer's
unfinished payment), and not `REJECTED`. `PaymentStatus.EXPIRED` is likewise distinct from `FAILED`:
finance must be able to tell an abandoned checkout from a declined card. Migration
`20260923110000_payment_expiry_states` adds the two values and nothing else.

**Scope, stated rather than assumed.** Only **PENDING** bookings are expired. A booking that reached
ACCEPTED has a partner committed to it (43 such bookings are ACCEPTED-but-unpaid on live today);
cancelling that is a different business event with a different cost — **owner decision O9**. Only
bookings whose appointment is still in the future are expired, because the point is capacity; the
past-dated backlog is *reported* by every sweep and never silently rewritten.

**What it must never do.** The candidate query filters on payment state and the decision is
RE-CHECKED under `FOR UPDATE` inside the transaction, because a capture can land in between. A
booking with any non-unsettled payment row is skipped. Pinned by a test that settles the booking
after it already qualifies as a candidate.

**A capture that arrives after the window closed** (owner item 7) goes through the one authoritative
path, `reconcileFromWebhook`, which now recognises an EXPIRED payment and **does not confirm
anything** — the slot has been released and may already belong to someone else, so settling would
risk double-booking a partner. Instead it binds the gateway payment id to the row, records
`capturedAfterExpiry` in its metadata, raises a **CRITICAL** `payment_captured_after_expiry` ops alert
carrying every identifier, and returns `handled` so the gateway stops retrying. The refund is **not**
issued automatically: moving a customer's money is an instruction, not an inference. That handoff is
deliberate and is the remaining owner action on this path.

Financial invariants asserted: no journal claiming an expired booking was paid, exactly one payment
row, the slot stays released, and a repeated delivery of the same late capture changes nothing.

Cadence: its own maintenance tick every 60 s under its own leader lock (`maintenance:payment_expiry`),
so expiry keeps its cadence even when the slower gateway reconciliation is busy.

## 6c. No-show — §52 / §53 (owner decision 2026-09-23)

Owner defaults: **provider grace 15 minutes**, **customer no-show fee 50% capped at what was
captured**, **provider no-show never charges the customer**.

Two outcomes that must never become each other:

| Status | Who may report it | What it costs |
|---|---|---|
| `CUSTOMER_NO_SHOW` | the assigned partner, or an admin | 50% of the subtotal, **capped at the amount still refundable across every tender**; the remainder is returned |
| `PROVIDER_NO_SHOW` | the customer, or an admin | nothing — the customer is made whole |

### The clock is not evidence

§52 is explicit that a customer no-show needs operational evidence, not a passed appointment time.
`evaluateCustomerNoShow` therefore refuses unless **all** of these hold:

* the booking is in a state where the customer could still have answered (`ACCEPTED`, `ASSIGNED`,
  `EN_ROUTE`) — a started, finished or closed job is `BOOKING_NOT_AWAITING_CUSTOMER`;
* `arrivedAt` is set — somebody actually travelled there. Absent it the answer is
  `NO_ARRIVAL_EVIDENCE`, however late the booking is;
* the grace period elapsed **after that arrival** — otherwise `GRACE_NOT_ELAPSED`;
* the arrival is not in the future — clocks that disagree decide nothing (`ARRIVAL_IN_FUTURE`)
  rather than guessing.

§53 forbids fabricating GPS, and nothing here consults it: `arrivedAt` is written by the arrival
path, not by this one. A missing ping is not proof of an absence, and inventing proof is worse than
having none.

### Authorization is half the rule

A partner cannot report a *provider* no-show — they cannot absolve themselves — and a customer
cannot declare their own. Neither status can be converted into the other afterwards: both are
terminal in the state machine with no transition between them, which is what stops a partner's
absence being re-labelled as the customer's fault later.

### The money

What is still owed back is asked of `bookingRefundService.refundableRemaining`, the same authority
the cancellation path uses, and paid through `processCancellationRefund`. Reading the `payments`
row directly was the first implementation and the tests caught it: a **wallet-paid booking has no
payments row at all**, so a customer no-show computed a fee of ₹0 on a booking that had been paid in
full. Gateway, wallet and split have to be one question asked in one place.

Capacity is released by the existing slot trigger — both new statuses fall outside its live set, so
the provider and user slot columns null themselves and the hour becomes bookable again.

### What §54 does *not* become

§54 says a cancellation after the service has started should route through the no-show rules. It
deliberately does not, and the reason is in the rules themselves: an `IN_PROGRESS` job is
`BOOKING_NOT_AWAITING_CUSTOMER` — a partner who is on site and working is not a no-show, and
forcing that path would mean recording an absence that did not happen. The `in_progress` tier
(50%) therefore still governs a customer who cancels mid-service. What §54 was protecting against —
a partner at the door with nobody answering being settled as an ordinary cancellation — is exactly
the case `CUSTOMER_NO_SHOW` now owns. Whether a started job should be uncancellable outright is a
change to customer terms and stays an owner decision (O3b below).

### It has to reach an app that is already open

Both transitions publish through `lib/booking-realtime`, the one publisher for every booking
transition. This was missed in the first cut: the status changed in the database and nothing went
out on the socket, so a customer watching their booking would have kept seeing `EN_ROUTE` on a
booking that was already closed and refunded — the same failure as rendering `EXPIRED` as
"confirmed", one layer down. The payload carries `feeAmount` and `refundAmount` so the app can say
what happened to the money without a refetch.
### And it says why

The refund path already sends "Refund processed ₹X". On a customer no-show that is a **partial**
refund with no explanation attached, so somebody charged half the price would never learn why. Both
outcomes now also send a `booking_no_show` notification naming the wait, the percentage and the
amount — and, on a provider no-show, the partner is told as well, because an absence reported
against them is theirs to know about. Neither message calls it a cancellation, because it is not
one.
### The HTTP surface

| Route | Who | Refuses with |
|---|---|---|
| `POST /api/bookings/:id/no-show` | assigned partner (`requireProvider`) | 403 to anyone else, 400 + `NO_ARRIVAL_EVIDENCE` / `GRACE_NOT_ELAPSED` with `waitedMinutes` and `graceMinutes` in the body |
| `POST /api/bookings/:id/provider-no-show` | the booking's customer (`requireAuth`) | 403 to the partner and to any other customer, 400 `INVALID_STATUS` once it is closed |

### A defect wiring the routes exposed

`deriveJobState` — the partner job axis — reads **timestamps**, and the three new terminal statuses
were not read before them. A `CUSTOMER_NO_SHOW` row still carries the `arrivedAt` that produced it,
so it derived as `ARRIVED` and the partner app offered **"Start service" on a booking that was
already closed and refunded**. `EXPIRED` fell all the way through to `OFFERED` and offered *Accept*
on a slot the server had already released. The status is now read before any timestamp, in the
backend and in **both** partner client mirrors (`apps/partner-web`, `homigo-partner-mobile`), which
carry their own copy of the policy for optimistic CTAs and had the identical bug.

`REPORT_NO_SHOW` is offered only at the `ARRIVED` stage — the only stage where the evidence the
service demands can exist — and is disabled with "Available in N min" until the grace has actually
been served, so a partner is told how long is left instead of tapping into a 400.
### Clients

Both statuses reach every client as their own presentation state, with the wording separated on
purpose: the provider case tells the customer they **have not been charged**. They are never
collapsed into `cancelled` or — the failure `EXPIRED` already taught us — into `confirmed`.
## 6d. The authority decisions — O3b, O4, O5, O6, O7, O8

Locked by the owner 2026-09-23 and now enforced, each with a test that fails when it is undone.

### O3b — a started job is a controlled stop, not a cancellation

A customer cancelling an `IN_PROGRESS` booking is refused with **409 `SERVICE_IN_PROGRESS`** and
pointed at support. The partner ending their own job and support stopping it both still work — this
removed one actor from one status, not the path.

It is deliberately **not** routed to the no-show rules: an `IN_PROGRESS` booking is
`BOOKING_NOT_AWAITING_CUSTOMER` there, and recording an absence that did not happen would be worse
than refusing. The `in_progress` tier survives as DATA, marked `selfServe: false`, because a
controlled stop still settles at its numbers.

Two things fell out of wiring it:

* the cancel route **fell through to `success: true` for every error it did not name**, so the next
  error code added to `cancel()` would have told a customer "Booking cancelled successfully" while
  the booking was untouched. It now fails closed.
* the customer clients offered Cancel on the collapsed `in_progress` state, which also covers
  `EN_ROUTE` — where cancelling is still allowed. The rule therefore reads the BACKEND status
  (`lib/booking-cancel-rules.ts`, web and mobile), and a started job shows the reason instead of a
  missing button.

### O4 — eligibility, and the finding it produced

All fifteen locked dimensions are evaluated server-side, each by the authority that already owns
it — there is deliberately **no sixteenth "eligibility engine"**, because a module that re-answers
all fifteen is a second source of truth that will eventually disagree with the first.
`o4-eligibility-dimensions.test.ts` pins each dimension to its owner AND to a call site, because a
check nobody calls protects nothing.

Writing that matrix produced a finding worth recording: **`SAFETY_HOLD` and `COMMERCIAL_HOLD` are
Phase 06 CONTENT statuses, not runtime gates.** Nothing in the booking path looks for a status of
that name, and reading the Phase 06 documents could easily leave someone believing otherwise. At
runtime both questions are answered fail-closed by `assertBookable`:

| Dimension | Runtime answer |
|---|---|
| safety readiness | `REQUIREMENTS_CONFIG_INVALID` — requirements unknown, inactive, conflicting or undecided make the service unbookable rather than guessed at |
| commercial readiness | `PRICING_CONFIG_MISSING` — incomplete authoritative pricing is unbookable whatever the lifecycle flags say |

The same file also pins that no dimension is answered twice: quote, create and validation all call
`coverageAllowsAddress` itself rather than each having a rule that happens to agree today.

### O5 — reference geography is not commercial coverage

`data/hyperlocal-coverage.ts` is presentation and planning data. **Sellability is decided only by
`coverageAllowsAddress`**, which reads the service's own `availableCities` and
`catalogConfig.coverage`. A city in the seeds buys nothing; a city the seeds have never heard of is
sellable if commercial coverage names it. A structural test asserts no sellability module imports
the reference-geography module, because the day one does there are two sources of truth and the
cheaper one wins.

### O6 — the late-reschedule fee

`lib/reschedule-policy.ts`, version `reschedule.v1`:

| When the move is made | Outcome |
|---|---|
| 2 hours or more before the appointment | `FREE` |
| under 2 hours | `LATE_FEE` — **25%** of the service subtotal (`LATE_FEE_BPS = 2500`) |
| after the service started | `NOT_PERMITTED` |

Four properties hold the money side:

* **integer paise, rounded once, half-up** — through `percentToRupeePaise`, the same centralised
  helper the quote engine uses, so a reschedule fee rounds exactly as every other amount does;
* **capped twice** — at the service subtotal AND at what is actually captured and still held;
* **nothing captured means nothing owed** — a fee is not a debt;
* **no negative can be produced** — both inputs are clamped before the percentage is taken.

The tier is decided by how close the **existing** appointment is, never the slot the client asks
for; taking it from the requested slot would let a client dodge the late tier by choosing a distant
new time. The subtotal comes from the booking row and the captured amount from
`refundableRemaining` — neither is ever read from the payload.

**The policy is frozen on the booking** (`serviceConfigSnapshot.policy.reschedule`) beside the
cancellation policy, and read back through `reschedulePolicyFromSnapshot`, which VALIDATES rather
than trusts: a missing, malformed or out-of-range snapshot falls back to the published policy
instead of half-applying a percentage nobody agreed to. A later change to the 25% therefore cannot
re-price a move on a booking already sold.

**What the fee does NOT do: move money.** Collecting it would mean a wallet debit or a gateway
charge in the middle of a reschedule, and a reschedule that fails because a wallet is short is a
product decision that was not authorised here. The amount is computed, logged, counted
(`reschedule_late_fee_total`), carried on `homigo.booking.rescheduled`, and shown to the customer
**before** they confirm via `GET /api/bookings/:id/reschedule-quote`. What it is not is applied
silently.

That quote endpoint is also what removed a lie: the web confirm dialog used to read *"No extra
charge unless your plan says otherwise"*, which stopped being true the moment the fee was set. Both
clients now render the server's number and never derive the percentage themselves.
### O7 — money goes back the way it came

Wallet-funded refunds are credited to the wallet with a ledger movement; gateway-funded refunds go
to the gateway; a split does both legs. There is no path that routes to a different tender, and
anything the orchestrator cannot resolve becomes `RECONCILIATION_REQUIRED` for a human rather than
being re-routed.

### O8 — the catalog prices, not the caller

`resolvePackagePrice` accepts only an **exact approved tier** — ₹650 for a ₹499/₹799/₹999 service
is `INVALID_PACKAGE_PRICE`, because a range is not a price list. The booking schema accepts add-on
**ids and quantities** and no prices at all.

The part that matters most for parts: an add-on that exists in the catalogue but has **no approved
price** does not resolve to ₹0. `resolveServiceSelection` refuses the whole selection with
`PRICING_CONFIG_MISSING`, naming the add-on id and the field, so an admin can see which part needs
pricing. The dangerous version — a silent zero — would let the booking succeed, charge the customer
nothing for the part, and still ask the partner to supply it.

There is no manual-quote path in the codebase, so the authority hierarchy collapses to approved
catalogue → approved service pricing, both resolved server-side.
## 7. Still owner decisions

| Id | Question |
|---|---|
| ~~O2~~ | **Decided 2026-09-23: 15 minutes.** Implemented — see §6b. |
| ~~O9~~ | **Decided 2026-09-23: no retroactive TTL.** The 44 ACCEPTED-but-unpaid bookings were classified read-only instead — 41 legacy unpaid, 2 payment-not-found, 1 indeterminate, **zero captured**. Nothing was modified. |
| ~~O10~~ | **Decided 2026-09-23: guarded auto-refund.** A late capture is refunded automatically only when order, amount and booking all agree and no refund exists; every ambiguity (order mismatch, amount mismatch, multiple payments, booking recovered or missing, refund already present) becomes `RECONCILIATION_REQUIRED` for a human. |
| ~~O3~~ | **Decided 2026-09-23.** Implemented — see §6c. |
| ~~O3b~~ | **Decided 2026-09-23: route to a controlled stop.** Implemented — see §6d. |
| ~~O6~~ | **Decided 2026-09-23: policy yes, amount CONFIGURATION_REQUIRED.** See §6d. Previously: The two halves of §45 that do not need a number are enforced: a booking may not be rescheduled once the service has started (`IN_PROGRESS` is outside `RESCHEDULABLE_BOOKING_STATUSES`), and a move two or more hours out is free. The "configured fee" for a move under two hours has **no configured value**, and inventing one would be inventing a price — so today every reschedule is still free, any number of times. |
| ~~O7~~ | **Decided 2026-09-23: original tender first, then reconciliation / admin review.** Enforced — see §6d. |
| ~~O4~~ | **Decided 2026-09-23: operational dimensions only.** No new dimension added — see §6d. |
| ~~O5~~ | **Decided 2026-09-23: commercial coverage is the sole sellability authority.** Enforced and structurally guarded — see §6d. |
| ~~O8~~ | **Decided 2026-09-23: approved catalog > approved service pricing > authorised manual quote.** No manual-quote path exists; off-tier prices are refused — see §6d. |

## 7b. The no-show migration is applied to live

`20260923120000_no_show_states` was deployed to `homigo_db` by the owner and **verified here by
measurement, not by report**:

* `BookingStatus` now carries 12 values, including `CUSTOMER_NO_SHOW` and `PROVIDER_NO_SHOW`;
* `_prisma_migrations` holds the row with `finished_at` set and `rolled_back_at` NULL, and the
  applied count moved 136 → 137;
* `tables` is unchanged at 225 — the migration was additive, exactly as written;
* the generated Prisma client and the live database agree: a read-only
  `booking.count({ where: { status: { in: [CUSTOMER_NO_SHOW, PROVIDER_NO_SHOW] } } })` against
  `homigo_db` succeeds and returns 0. Before the migration the same query errored with
  `invalid input value for enum "BookingStatus"`.

The migration is **not** re-applied, resolved, or duplicated by anything in this phase.

What is still not claimed: no authenticated no-show has been recorded against a real booking on
`homigo_db`. Doing that would mean creating or altering a real customer's booking to prove a point.
The write path is verified against the isolated database instead, and the live evidence stops at
the schema, the client and the guarded endpoints.
## 7c. Runtime evidence, and what it does NOT show

Read-only probes against the running backend on `:3000` (which reports `isolatedDatabase: false`,
i.e. `homigo_db`) on 2026-09-23:

* `POST /api/bookings/:id/no-show`, `POST /api/bookings/:id/provider-no-show` and
  `POST /api/admin/bookings/:id/no-show` all answer **401** unauthenticated — mounted and guarded,
  and refused before any database write.
* `GET /api/bookings/cancellation-policy` returns the `in_progress` tier with **`selfServe: false`**
  while the others carry no flag, so O3b is visible at the API boundary.

What this does **not** show, and is not claimed: no authenticated no-show was recorded against
`homigo_db`, because the enum values are not there. The no-show path is therefore
**ENGINEERING COMPLETE**, not live-verified.

Browser: the customer web app on `:3001` renders (`/` 200 with content, `/bookings` correctly
redirecting an anonymous visitor to `/login`). The booking-detail modal changes are not covered by
that smoke — exercising them needs an authenticated session against a non-live backend, and the only
backend running is on the live database.
## 8. Evidence

- `phase09-policy-snapshot.test.ts` — 13 tests: published ids match charged ids, every boundary
  preserved, fee/refund always sum to the amount paid, frozen tiers win, snapshots validated.
- `phase09-policy-snapshot.integration.test.ts` — 6 tests over the isolated database, including a
  **wallet-paid booking refunded 65% by its frozen policy while the live policy would have refunded
  100%**, with the credit waited for rather than assumed.
- `phase09-booking-idempotency.integration.test.ts` — 11 tests, including **20 concurrent identical
  requests with one key producing exactly one booking**, expiry reclaim, and the sweep.
- `phase09-reschedule-event.integration.test.ts` — 5 tests: payload, actor, and absence on both a
  refused and a rolled-back reschedule.
- `phase09-missed-webhook-reconcile.integration.test.ts` — 6 tests with the gateway stubbed:
  settlement through the webhook path with its ledger journal, idempotent re-run, unpaid left alone,
  under-age left alone, unconfigured gateway, and gateway error.
- `phase09-no-show-policy.test.ts` — 14 pure tests: the clock alone never produces a no-show, the
  fee is capped at what was captured, and a provider no-show never yields a customer fee.
- `phase09-no-show.integration.test.ts` — 17 tests over the isolated database: evidence gate,
  authorization both ways, slot release through the trigger, the impossibility of converting one
  no-show into the other, the socket broadcast for each outcome, and the notification that
  explains the fee to the customer and the absence to the partner.
- `phase09-no-show-api.integration.test.ts` — 11 tests over HTTP: codes a client can act on, 403 in
  both directions, 401 unauthenticated, and the "you have not been charged" wording.
- `section03-job-action-policy.test.ts` — extended to 15: the three closed statuses offer the
  partner nothing however complete the timestamps look, and `REPORT_NO_SHOW` is gated by the grace.
- `homigo-partner-mobile/src/lib/__tests__/job-action-policy.test.ts` — 4 tests pinning the same
  property on the client mirror.
- `phase09-controlled-stop.integration.test.ts` — 5 tests: a customer refused on a started job with
  the booking and the money untouched, the same customer still allowed before it starts, support
  still able to stop it, and a wallet refund landing in the wallet as a real ledger movement with no
  gateway attempt.
- `policy-authority-invariants.test.ts` — 25 tests over O3b, O5, O6, O7, O8 and the no-show enum,
  including the structural guards: no sellability module imports the reference geography, the cancel
  route fails closed, and the reschedule tier is decided from the booking's own appointment.
- `job-action-mirror-parity.test.ts` — 7 tests holding the three copies of the job-action policy
  together. This is also the only executable regression protection `apps/partner-web` has.
- Closure reintroduction: **12 of 12 caught** —
  `docs/operations/evidence/commercial-core-closure-reintroduction-2026-09-23.txt`.
- `policy-authority-invariants.test.ts` — 38 tests over O3b, O5, O6, O7, O8 and the no-show enum,
  including the O6 fee arithmetic (25%, integer paise, half-up, capped at subtotal AND captured,
  never negative, frozen policy wins) and the O8 add-on case where a missing price refuses the sale
  instead of costing zero.
- `o4-eligibility-dimensions.test.ts` — 21 tests: each of the fifteen dimensions pinned to its
  owner AND its call site, plus "no dimension is answered twice".
- `runtime-warning-controls.test.ts` — 7 tests holding the two controls that make the recurring
  warnings safe: no ML model may serve a product path, and matching may never treat a stale or
  expired provider as present.
- `apps/partner-web/tests/` — **the app had no unit-test harness at all.** It now uses the same one
  `apps/web` uses (`bun test` with the `@/` alias, no new stack): 33 tests over the job axis,
  terminal states, the three closed statuses, action gating and realtime frame filtering. Both Next
  apps also gained the `test` script they were missing.
- Migration parity: `certify-fresh-migrate` rebuilt `homigo_cert_migrate` from all **134** migrations
  with `migrate deploy` alone — 3041 model fields, 221 models, 222 tables, 35 protected objects,
  drift OK.

---

## 9. Defect reintroduction matrix (Wave 3 + Wave 4)

Every fix was reverted one at a time in an isolated copy on D: (`homigo_test` only, never the live
database), the suites re-run, and each file restored byte-identically. A green baseline (78/0) is
asserted before any reintroduction, so a red baseline cannot produce meaningless results. The harness
also aborts if a patcher fails to load — without that guard one broken case silently ran the ENTIRE
suite and reported its unrelated failures as "caught".

**35 of 36 caught.** Full log:
`docs/operations/evidence/commercial-core-wave3-4-reintroduction-2026-09-23.txt`.

| Group | Cases | Result |
|---|---|---|
| Idempotency (P1, P1b–P1e) | key ignored, claim never completed, key not released, fingerprint ignored, read-then-write claim | all CAUGHT |
| Policy snapshot (P2, P2b, P2c, P3, P3b) | live policy applied, terms not recorded, snapshot trusted unvalidated, `very_late` returned, boundary flipped | all CAUGHT |
| Reschedule event (P4, P4b) | customer and admin emission removed | both CAUGHT |
| Missed-webhook reconcile (P5, P5b, P5c) | sweep unwired, unpaid order settled, age threshold dropped | all CAUGHT |
| Snapshots (P6) | schedule decision not recorded | CAUGHT |
| TTL (T1, T1b, T2, T3, T4, T5, T6b) | both in-transaction re-checks, scope widened to ACCEPTED, event dropped, cutoff ignored, late capture confirms, past-dated rewritten | all CAUGHT |
| TTL (T6) | past-dated scope widened, **outer layer only** | **NOT CAUGHT** — masked by the in-transaction date guard. T6b, which removes both, is caught. Defence in depth, reported rather than hidden. |
| Availability (A1, A2, A3) | occupancy ignored, working window ignored, service time rules skipped | all CAUGHT |
| Slot grid (G1, G2) | appointment may overrun the window, 24×7 by default | both CAUGHT |
| No-show (N1–N4) | arrival evidence dropped, grace ignored, fee uncapped, provider no-show charges the customer | all CAUGHT |
| No-show (N5–N7) | customer may declare their own, partner may absolve themselves, settlement reads the payments row again | all CAUGHT |

### Two test gaps the matrix exposed

1. **The TTL in-transaction re-check was never exercised.** The original test settled the payment
   *before* the sweep, so the candidate query filtered it out and the re-check was never reached —
   deleting the re-check left every test green. It is now tested with a deterministic interleaving
   that settles the payment *between* the candidate scan and its transaction, and the test asserts
   that its own hook actually fired. (The first attempt at that hook used `spyOn`, which silently
   does not intercept `$transaction` because it lives on the client's prototype; the test then
   "failed" against correct code. An own property on the instance shadows it correctly.)
2. **Nothing asserted the booking sweep was wired into the scheduled reconciliation.** The sweep
   passed every test that called it directly while never being called in production. There is now a
   test on `reconcilePendingOrders` itself.
