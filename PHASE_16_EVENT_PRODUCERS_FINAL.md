# PHASE 16 — EVENT PRODUCERS (FINAL)

## What changed

The previous phase closed with two triggers declared **unwireable**: `homigo.support.ticket.created`
and `homigo.ops.alert.raised` did not exist, because both owning services wrote their rows directly
and published nothing. That was recorded honestly rather than faked — and it was an engineering gap,
not a fact of the platform.

Both producers now exist, emit through the **existing transactional outbox**, and are proven by
driving the real service methods.

| Event | Producer | Emission |
|---|---|---|
| `homigo.support.ticket.created` | `supportTicketService.create` | inside `runTicketCreateTx` |
| `homigo.ops.alert.raised` | `opsAlertService.raise` | inside a `$transaction` with the row |
| `homigo.partner.paused` | `partnerOperationsService.pause` | pre-existing, `emitInTransaction` |

## Why inside the transaction

**Support** — `runTicketCreateTx` retries on ticket-number conflicts and on retryable Prisma
errors, re-running the whole closure each time. Emitting outside it would publish an event for a
ticket a later attempt replaced; emitting after it would open a window where the ticket exists and
the event does not. Inside, a rolled-back attempt takes its outbox row with it and the retry writes
a fresh event id for the row that actually survived.

**Operations** — `raise` returns `null` once five unresolved alerts of a type exist within the
hour, and creates nothing. The event is emitted **after** that suppression check, so no row means no
event. Publishing on the suppressed path would announce an alert that does not exist, and any
consumer acting on it would be chasing a dangling id.

> **Proven, not asserted.** A transaction that writes a ticket and its event and then throws leaves
> **neither** — `orphanTickets=0 orphanEvents=0` (P5).

## What the payloads deliberately omit

No ticket subject, no ticket description, no alert message body. Three independent reasons, any one
sufficient:

1. `assertNoProhibitedPii` scans the serialised payload. A customer describing their problem will
   eventually include an address or a phone number — which would abort the enclosing transaction.
   **A customer's ticket would fail to be created because of what they wrote in it.**
2. The consumer that needs the text is the agent, and it reads it through
   `read.support.getTicketContext` — governed, RBAC-checked, audited. Putting the same text in the
   event creates a second, ungoverned path to it.
3. Untrusted prose in an event payload is prompt-injection cargo. The agent trigger builds its goal
   from the **trigger definition**, never from the payload, precisely so whoever can write the
   payload cannot write the agent's instructions.

> **Checked against the actual bytes** (P3, Q2), not by trusting the builder — a later edit that
> "helpfully" adds the subject for debugging fails the test.

## Certification

`scripts/phase16/event-producer-certification.ts` — **12 PASS / 0 FAIL**, deterministic across
three consecutive runs.

| Check | Result |
|---|---|
| P1 | Ticket write produces an outbox row |
| P2 | Event bound to the ticket aggregate |
| P3 | Payload carries ids and classification, never free text |
| P4 | Each ticket produces exactly one distinct event |
| P5 | A rolled-back ticket leaves neither row nor event |
| Q1 | Raising an alert produces an outbox row |
| Q2 | Event carries type and severity, never the message body |
| Q3 | Suppressed alerts publish no event; one event per created row |
| R1 | Both previously-unwireable triggers registered |
| R2 | Agent consumer subscribed to both new event types |
| R3 | `UNWIRED_TRIGGERS` is empty |
| R4 | INFO excluded, CRITICAL included — the condition is real |

## A flaky test that was fixed at the root

Q3 first reported **4 events for 5 alert rows**, then 5/5 on the next run. The producer was correct
every time — proven three separate ways (isolated 5/5, by-aggregate-id 5/5, two full runs 5/5).

The **test** was clock-dependent: `event_outbox.created_at` is assigned by the **database** clock,
and the harness filtered on a cutoff taken from the **application** clock in a different container.
Measured skew was 289 ms and it drifts, so a row inserted moments after the cutoff can carry a
timestamp moments before it.

Fixed by matching on **aggregate id** — exact, clock-independent. A test that fails intermittently
because of clock drift is not evidence, and worse, it trains whoever reads it to dismiss the next
real failure.

## Trigger contracts

| Trigger | Agent | Condition | Cooldown |
|---|---|---|---|
| `support.ticket.created` | support | `ticketId` present | 5 min |
| `ops.alert.raised` | operations | severity ∈ {WARNING, CRITICAL, ESCALATION} | 10 min |
| `partner.paused` | partner-operations | `providerId` present | 30 min |

INFO alerts are excluded deliberately: they fire constantly and none needs an investigation. An
agent run per INFO alert would be an inference bill with no reader.

`UNWIRED_TRIGGERS` is retained as an **empty** exported array rather than deleted. The honest thing
to do with a trigger that cannot be wired is to declare it where the registry reader and the status
endpoint can both see it — not to register a subscription against an event that never fires.
