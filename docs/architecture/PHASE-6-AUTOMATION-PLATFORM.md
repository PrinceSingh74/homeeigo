# Phase 6 — Automation Platform

## What this is

An automation is a standing answer to "when X happens, and Y is true, do Z — then check it worked."
HOMIGO already has the machinery to run one-shot delayed jobs reliably. What it does not have is a
way to express a *workflow*: several steps, spread over hours or days, that can wait, re-check a
condition that may have changed, escalate when nothing improves, and stop when the thing it cared
about resolved itself.

That gap is the whole of Phase 6.

## What already exists — do not rebuild

`src/events/core/job-processor.ts` is production-grade and stays as the execution substrate:

| Capability | Where |
|---|---|
| Batch claim with `FOR UPDATE SKIP LOCKED` | `claimJobBatch` |
| Lease-based recovery of dead workers | `recoverStaleJobs` |
| Retry with backoff | `computeRetryDelayMs` |
| Dead-letter on terminal failure | `recordDeadLetter` |
| Staleness skip, distinct from failure | `markSkipped` |
| Per-job timeout | `withTimeout` |
| Single-runner guarantee across nodes | `runWithLeaderLock` |
| Metrics | `homigo_scheduled_job_*` |

The event foundation is equally complete: transactional outbox, 15 event types, consumer registry,
PII redaction, DLQ.

**Phase 6 adds a layer above these, and changes neither.**

## The four missing pieces

### 1. Workflow registry — steps instead of a single action

Today a trigger creates one job that does one thing. A workflow is an ordered list of steps, each
of which may wait, evaluate, act, or stop. Each step schedules the next as an ordinary
`ScheduledJob`, so every guarantee above is inherited rather than reimplemented.

```
booking.completed
      ↓
  [wait 2h] → [is it still uncancelled?] → [already rated? stop] → [send review request]
                                                                        ↓
                                                          [wait 24h] → [rated? stop] → [one reminder]
```

Versioned, because a workflow in flight must finish under the definition it started with. Changing
a live workflow underneath running instances is how you get an instance that waited under v1 rules
and acted under v3 rules.

### 2. Condition layer

Conditions are evaluated at the moment of action, not at the moment of scheduling. Between the
trigger and the act, the world moves: the booking is cancelled, the customer already rated, the
partner came back online, the payment succeeded on retry. **A workflow that does not re-check is a
workflow that sends the wrong message.**

### 3. Cadence control — the difference between premium and spam

This is the piece most automation systems get wrong, and the one users feel most.

Three independent limits, all of which must pass:

- **Per-recipient** — no more than N automated messages per person per day, across *all* workflows
- **Per-workflow-per-recipient** — this particular workflow may reach you once per cooldown window
- **Quiet hours** — nothing outbound between 21:00 and 08:00 IST; deferred to the morning, not dropped

Without this, ten well-meaning automations become one bad experience.

### 4. Shadow mode and audit

Every workflow can run in shadow: conditions evaluate, decisions are recorded, actions do not fire.
That is how a new automation earns trust before it is allowed to touch a customer.

Every decision — fired, skipped, suppressed by cadence, condition failed — is recorded with the
reason. "Why did this customer get this message?" and "why did they not?" must both be answerable.

## The automation catalog

Ordered by business value, not by ease. HOMIGO already has geo-intelligence, weather, demand
forecasting, fraud scoring, customer intelligence (churn/CLV) and partner OS — automation should
use them, not just send reminders.

### A. Revenue protection

| Automation | Trigger | Why it matters |
|---|---|---|
| **Payment recovery** | `payment.failed` | Retry link at +10min, wallet/alternate-method nudge at +2h, expire at +24h. Recovers bookings already won |
| **Abandoned booking** | `booking.created` with no payment | Nudge at +15min. The intent was there; the checkout was not finished |
| **Subscription renewal** | expiry − 7d / − 1d | Reminder, then a last-day offer |
| **Credit expiry** | HCoin/cashback nearing expiry | "Use it" nudge — drives a booking and avoids a support complaint |
| **Stalled refund** | refund not `COMPLETED` after 48h | Escalate to ops before the customer chases |
| **Indeterminate refund** | refund status `INDETERMINATE` | Gateway reconciliation sweep. Closes the F2 limitation: today an unknown outcome waits for a human to notice |

### B. Supply and demand — the differentiator

| Automation | Trigger | Why it matters |
|---|---|---|
| **Pre-emptive mobilisation** | demand forecast spike | "Tomorrow 18:00, Sector 62 needs 8 partners, 3 are available" — sent *before* the shortage, to partners who work that zone |
| **Weather response** | severe weather forecast | Surge adjustment + partner advisory + customer ETA warning, together |
| **Coverage gap** | booking attempts in an unserved pincode | Ops alert with volume, so expansion is driven by data |
| **Idle partner in hot zone** | `partner.online` + high-demand zone | Directed nudge, not a broadcast |

### C. Booking lifecycle — where trust is won or lost

| Automation | Trigger | Why it matters |
|---|---|---|
| **Dispatch stall** | assigned, not `en_route` by T−30 | Nudge partner, then re-assign. The customer never learns there was a problem |
| **Arrival stall** | `arrived` but not started in 15min | Check in with both sides |
| **Overrun** | running far past estimated duration | Proactive contact before the complaint |
| **Review request** | `booking.completed` + 2h | *Already built* — extend with one polite reminder |
| **Cancellation recovery** | `booking.cancelled` | Rebook offer, reason-aware — a partner no-show deserves a different message than a change of plan |

### D. Partner retention — cheaper than acquisition

| Automation | Trigger | Why it matters |
|---|---|---|
| **Going quiet** | no jobs for N days | Re-engagement before they drift to a competitor |
| **Rating decline** | rolling rating crosses down | Coaching, early, while it is fixable |
| **Earnings drop** | earnings below the partner's *own* average | Their baseline, not a global one |
| **KYC expiry** | document expiring | Renewal before they are blocked from working |
| **Stuck withdrawal** | payout pending too long | Nothing damages partner trust faster than money that has not arrived |

### E. Customer lifecycle

| Automation | Trigger | Why it matters |
|---|---|---|
| **Churn intervention** | churn score crosses threshold | The model already exists and nothing acts on it |
| **First-booking onboarding** | first `booking.completed` | The second booking is the one that makes a customer |
| **Membership offer** | repeat-booking pattern | Offered on evidence, not on a schedule |

### F. Trust, safety and finance

| Automation | Trigger | Why it matters |
|---|---|---|
| **Fraud hold** | fraud signal above threshold | Hold + queue for human review. **Never auto-punish** |
| **Ledger imbalance** | integrity check fails | Page immediately — a silent imbalance is the worst financial failure |
| **Settlement mismatch** | gateway reconciliation discrepancy | Reconcile automatically, escalate what it cannot resolve |
| **Support triage** | `support.ticket.created` | Route by category, priority and history; escalate on SLA breach |

## Two rules that keep this safe

**Automation never performs a high-risk action.** The Phase-5 boundary holds exactly as it is:
refund, payout, settlement, wallet adjustment, ledger change and account freeze all require human
approval. Automation may *prepare* a recommendation and place it in the approval queue. It may not
approve it. An automated system that can move money without a human is not an automation platform,
it is an incident waiting for a trigger.

**Automation is observable or it is off.** Every workflow reports fired / suppressed / condition-failed
counts. A workflow whose suppression rate suddenly spikes is telling you something changed upstream.

## What must be built first

Nothing in the catalog can be built well until the platform exists. Order:

1. **Workflow registry + versioned definitions** — schema, registry, step executor on top of `ScheduledJob`
2. **Condition evaluation** — re-check at action time
3. **Cadence control** — per-recipient, per-workflow, quiet hours
4. **Shadow mode + decision audit**
5. **Multi-channel delivery** — `notification.service` is push-only today; email and SMS exist as separate services with no routing layer
6. Then the catalog, starting with **payment recovery** and **dispatch stall** — the two with the clearest revenue and trust impact

## Honest constraints

- `notification.service` currently supports **push only**. Multi-channel routing is a prerequisite
  for most of the catalog, not an optional extra.
- Cadence control needs a decision log before it can enforce anything; build them together.
- Weather and demand-forecast automations depend on data freshness. A stale forecast driving a
  partner advisory is worse than no advisory — each must check freshness before acting.
