# Owner decisions — register and resolutions

Each entry is a place where the code encoded a behaviour nobody had explicitly chosen, and where an
engineer picking an answer would have been picking business policy.

The 2026-09-15 pass **recorded** items 1–7 and left them open. The 2026-09-17 pass was authorised to
**decide** them, along with three more surfaced by the Section 5–6 engineering work. Every decision
below was selected against the same criteria, in this order: user safety, security, financial
integrity, consistency with the existing architecture, least surprising behaviour, operational
reliability, backward compatibility where reasonable — preferring whichever option minimises
irreversible risk and protects users and their data.

Where the evidence contradicted the obvious answer, that is recorded too. Two of these reversed the
first conclusion.

---

## 1. Should dispatch wait for payment? — **DECIDED: yes, withhold**

**Question.** Bookings were fanned out to partners at creation, before `paymentStatus = SUCCESS`,
while `accept()` is payment-gated. Partners therefore received offers they could not accept.

**Evidence.** Measured across the database: **2,566 of 3,451 assignment jobs (74%)** were for
bookings that had not settled. The harm is not noise — an unanswered offer holds a place against the
partner's concurrency budget until it times out, and a timed-out offer counts as a **refusal** in the
acceptance rate the platform ranks partners by. Partners were being measured on, and throttled by,
offers they were never permitted to accept, because of the customer's payment rather than their own
behaviour.

**Decision.** `dispatchToNextProvider` returns early for an unsettled booking. The job row is still
created and left `PENDING`; only the fan-out waits. `onBookingPaymentSettled` dispatches on
settlement and the assignment cron re-sweeps `PENDING` jobs every 30 s, so no new machinery was
needed — this removes a premature call.

**Rejected alternative.** Keep dispatching and exclude unpaid offers from the acceptance rate. That
treats the symptom, still hands partners offers they cannot take, and still consumes their capacity.

**Cost accepted.** Matching starts after payment rather than before it.

**Where.** `assignment-engine.service.ts` `dispatchToNextProvider`.
**Tests.** `dispatch-payment-gate-decision.test.ts` (9).

---

## 2. How is a tip funded? — **UNCHANGED: wallet only**

Tips are debited from the customer wallet and credited through the wallet-transaction + ledger path;
an insufficient balance returns `402 TIP_INSUFFICIENT_WALLET`. Card/UPI tipping needs a Razorpay
order and a new customer-facing payment flow — that is a product feature, not a policy gap, and
building it would be creating new product behaviour rather than deciding a documented question.

**Where.** `rating.service.ts` `createWithTip`.

---

## 3. Commission on tips — **UNCHANGED: 0%**

Already explicit in `journalForBookingTip` (CUSTOMER_WALLET → PROVIDER_PAYABLE, no revenue line).
The tip reaches the partner whole. Nothing to decide.

---

## 4. Cashback reversal on partial refunds — **DECIDED: only a full refund reverses**

**Question.** `reverseOnRefund` reversed the entire cashback on *any* refund, so a ₹50 partial refund
on a ₹500 booking clawed back every rupee of the reward earned on the ₹450 the customer still paid.

**Decision.** Reversal now requires the payment to be fully refunded, using the same half-paise
tolerance the refund path uses to choose `REFUNDED` over `PARTIALLY_REFUNDED`. The rule lives inside
`reverseOnRefund` rather than at its three call sites, because a rule each caller must remember is
one a caller will eventually forget.

**Rejected alternative.** Pro-rating to the refunded fraction is more precise, and was rejected
because `MembershipCashback` has no reversed-amount column and a one-shot status machine — pro-rating
across successive partial refunds would need new persistent state on a money table.

**What decided it.** The asymmetry. Over-reversal cannot be undone: the debit is capped at the
customer's current balance, so someone who already spent the cashback keeps the shortfall and the
books and the balance disagree permanently. Under-reversal costs the platform a bounded amount, harms
nobody, and self-corrects when the remainder is refunded. For the same reason, a refund that **cannot
be shown** to be full (no payment row) is treated as partial.

**Where.** `cashback.service.ts` `reverseOnRefund`.
**Tests.** `cashback-partial-refund-decision.test.ts` (9), including concurrent-reversal and
one-shot cases.

---

## 5. "Pending amount" on the partner earnings tile — **DECIDED: withdrawals in flight**

**Question.** The figure was unconditionally 0 — it filtered on a `pending` earning state that has
never existed — while looking computed.

**Decision.** It now reports what `payout-operations.service` already treats as authoritative: the
sum of `netAmount` for withdrawals in `REQUESTED`, `APPROVED` or `PROCESSING` — money requested and
not yet in the bank. `FAILED` and `CANCELLED` are excluded because that money is back in the wallet
and already counted in `walletBalance`; including it would show the same rupees twice.

**What decided it.** Zero was the worst of the three options. A partner with a ₹5,000 withdrawal in
`PROCESSING` read "Pending: 0" and would reasonably conclude nothing was coming.

**Where.** `earnings-live.service.ts` `getEarningsData`.

---

## 6. En-route / complete without a GPS fix — **UNCHANGED: en-route allowed, arrive/start refused**

Technically resolved in 2026-09-15: unknown is `null` end-to-end, no distance is fabricated, and
arrive/start refuse without a real fix. The open question was whether en-route should also be
refused.

**Decision: leave it.** Refusing en-route strands a partner who is genuinely travelling but whose
phone cannot get a fix — indoors, in a basement car park, with GPS disabled — and the failure lands
on the person who is doing the work correctly. The state that actually matters for the customer and
for money, arrival and start, already requires a real fix. Tightening en-route would add a way to
block honest work without protecting anything that is not already protected.

---

## 7. Public provider discovery precision — **DECIDED: distance to the kilometre**

**Question.** `/api/providers/nearby` and `/search` are unauthenticated by design, and both returned
distance rounded to 100 m from a point the **caller** chooses. Distance from a chosen point is a
circle; three circles intersect at a point. Three anonymous requests located a working partner to
within about a hundred metres, and the partner could neither see it nor refuse.

**Decision.** Both surfaces now report whole kilometres through one shared helper. Rounded, not
floored, so a partner 200 m away reads as 1 km rather than 0.

**Rejected alternative.** Requiring a session. Pre-login browsing is deliberate product behaviour,
and coarsening defeats the attack rather than merely gating it — the residual inference collapses to
roughly a square kilometre, which says no more than "this partner works in this area", something
offering the service discloses anyway.

**Where.** `provider.service.ts` `publicDistanceKm`, applied at both public sites.
**Tests.** `public-distance-privacy.test.ts` (7), including the trilateration attack itself.

---

## 8. Refund retry backoff schedule — **DECIDED: exponential from the tick, first retry immediate**

**Question.** With no backoff, all five retry attempts were spent within 25 minutes. A gateway outage
lasting half an hour therefore burned every attempt on every refund in flight, after which a customer
needed a human to notice before their money moved.

**Decision.** `REFUND_RETRY_BACKOFF_SEC` defaults to 300 — the maintenance interval — applied
exponentially, with the **first** retry left immediate:

| attempt | next eligible |
|---|---|
| 1 | next tick (unchanged) |
| 2 | +5 min |
| 3 | +10 min |
| 4 | +20 min |
| 5 | +40 min |

**What decided it.** Leaving the first retry immediate is what makes this safe to adopt: no customer
waits longer for their first second chance, and only the tail spreads. The budget now spans roughly
75 minutes instead of 25, so an outage must last over an hour before a refund is exhausted.

**Where.** `booking-refund.service.ts` `nextRefundRetryAt`.
**Tests.** `refund-retry-scheduling.test.ts`.

---

## 9. "Service Fulfillment" on the city coverage page — **DECIDED: remains unmeasured**

**Question.** The figure was `seeded(98.2, 99.6)` — a hash of the city slug — shown to customers as a
fact. Section 6C replaced it with `null`, leaving the definition open.

**Decision.** It stays absent. It is a third label alongside completion rate and cancellation rate
with no distinct authoritative meaning; aliasing it onto the completion rate would show one number
under two labels, which is its own kind of misleading. Completion and cancellation are now measured
and published, so nothing is lost by omitting a third name for them.

**Where.** `hyperlocal-coverage.ts` `deriveCitySummary`; the web modal omits the tile when null, and
the admin console's city table dropped the always-empty "Fulfillment" column in favour of
`servicesCompleted`, which is measured.

---

## 10 & 11. `maxConcurrentJobs` and reserved offers — **DECIDED: unchanged, and now documented**

**Question.** `currentJobs` counts every booking in a concurrent status with no time bound, and
reserved offers are counted the same way, so a partner holding four accepted bookings across next
month is at capacity. Against the field's name that looks like a defect.

**First answer, implemented and then reversed.** Scope both to the booking's own time slot so
"concurrent" means "at the same time".

**Why that was wrong.** `bookings_provider_slot_excl` is an `EXCLUDE` constraint over
(provider_id, slot range) with **no status filter**, so the database already refuses to let one
partner hold two bookings whose slots overlap. Under a time-scoped reading `currentJobs` could never
exceed 1, and a limit defaulting to 4 with a ceiling of 20 would be dead code. This was proved, not
argued: seeding two accepted bookings twenty minutes apart for one partner is rejected with `23P01`,
and the test written to assert the "two concurrent bookings fill the budget" case could not be set
up at all.

**Decision.** Keep both. True simultaneity is enforced a layer down; this limit is the only thing
capping how much unfinished work a partner holds, which is a coherent rule, is the behaviour the
platform has always had, and is one partners raise themselves in settings up to 20. Reserved offers
keep holding a place for the same reason: between dispatch and answer the work is provisionally
theirs, and if offers did not reserve capacity a partner could be sent more work than their limit and
accept all of it.

**What is misleading is the name**, and that is now recorded where it is read.

**Where.** `lib/partner-capacity.ts`.
**Tests.** `capacity-concurrency-decision.test.ts` (9), including the constraint that decided it.

---

## Still open — recorded, not decided

These are reason codes the platform emits deliberately when it refuses to fabricate an answer. They
are working as designed; each needs a product definition before it can return a number, and inventing
one would be inventing policy rather than deciding a documented question.

| Code | Surface | What it needs |
|---|---|---|
| `MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED` | executive margin at zero GMV | a definition of margin when there is no revenue |
| `DEMAND_SUPPLY_THRESHOLD_HUMAN_DECISION_REQUIRED` | demand/supply warnings | the ratio at which a shortage is declared |
| `EXECUTIVE_REPORT_{SCHEDULE,RECURRENCE,TIMEZONE}_HUMAN_DECISION_REQUIRED` | scheduled executive reports | when reports run, how often, in whose timezone |
| `SUPPORT_{AUTOMATION_CONFIDENCE_THRESHOLD,LOW_RISK_ACTION_TAXONOMY,ESCALATION_TIMING,COMPENSATION_POLICY}_HUMAN_DECISION_REQUIRED` | support automation | what support may do without a human, and when |

Two engineering thresholds chosen during the Section 6 pass are tunable rather than policy, and are
recorded here so they are visible: `MIN_ARRIVAL_SAMPLES = 5` (journeys required before a city
publishes an average arrival time) and the ≥1-minute floor beneath it.
