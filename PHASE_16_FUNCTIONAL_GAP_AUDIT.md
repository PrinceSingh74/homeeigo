# PHASE 16 — FUNCTIONAL GAP AUDIT

§64 asks, for each agent: what can a real operator ask it, what should it answer, what should it
execute, what must require approval, what should it refuse, what should it escalate.

This pass answered those questions against the **actual** service layer rather than against the
previous pass's assumptions. Three of the gaps it found were governance holes, not missing
features — and none of them were visible from a green test suite.

---

## The three control gaps

### 1. §8 — nothing checked what was actually asked for

**The hole.** An operator could ask a purely diagnostic question, the model could return a plan
containing `ticket.resolve`, and every downstream control would wave it through.

That is not a bug in any of those controls. It is that each answers a different question:

| Control | Question it asks | Answer for "Why was this delayed?" → `ticket.resolve` |
|---|---|---|
| Policy engine | Is this actor allowed to do this? | Yes |
| Risk classifier | How dangerous is it? | MEDIUM — within ceiling |
| Agent registry | Does this agent own this capability? | Yes |
| RBAC | Does the role hold the permission? | Yes |
| Post-condition | Did the change actually land? | Yes, verified |

Every one passes. **Nobody asked whether a change had been requested at all.** An authorised action
that nobody asked for is still an unrequested action.

**The fix.** `agents/planning/intent.ts` resolves one of eleven intents from the request, and
`validatePlan` refuses any non-LOW step under an intent that does not permit a side effect.

**Why the classifier is deterministic and server-side.** The intent is an authorisation input. A
model that could declare `intent: EXECUTE` would be authorising itself — the same defect as
letting it declare its own risk tier.

**Why an unrecognised phrasing means ANALYZE.** The classifier is lexical and will not recognise
every phrasing, so the failure direction is chosen rather than left to chance:

- Misreading "fix this" as ANALYZE → one re-issue, with a message naming the refused step.
- Misreading "why did this happen" as EXECUTE → a side effect nobody asked for.

Those are not symmetric. Anything unrecognised becomes the read-only reading.

**Ordering is part of the design.** Diagnostic patterns are tested *before* imperative ones, so
"Why did this fail, and can you fix it?" resolves to EXPLAIN. A person who wants the second half
can ask for it alone — a cheaper mistake than the reverse.

### 2. §9 — an underspecified request was guessed at, not asked about

Before: "Resolve the ticket" with no id produced a plan whose step failed at the tool boundary,
burning a tool call and an audit row to discover something the validator already knew.

Now: required arguments are read from the tool's own `validationSchema.required` — one statement
of what a tool needs, so a second copy cannot drift — and a missing one produces a specific
question ("Which ticket? Give the ticket id or ticket number.").

**The run is ESCALATED, not FAILED.** The agent understood the request, found the one thing it
could not supply, and asked. Recording that as a failure would put a correct outcome into the
failure ratio driving the DEGRADED and ERROR health states, and an agent that asks good questions
would gradually look broken. `PLANNING → ESCALATED` was already a legal transition and the
questions ride in `metadata`, so this needed **no migration and no new run state**.

### 3. §35 — stale evidence could justify a write

**The hole.** A zone read returns a cached scoring from forty minutes ago; the supply gap it
describes has since closed; the agent resolves the alert tracking it. Every control passes — the
read succeeded, the write was authorised, the post-condition confirms the alert is now resolved —
and the platform has closed an alert about a condition it never re-checked.

**Verification proves the write happened. It says nothing about whether the reason was still true.**

**The fix.** Reads whose capability declares a freshness policy are assessed after execution; a
`STALE` or `UNKNOWN` verdict disqualifies that read from supporting a write later in the same run.
The write is escalated with `STALE_EVIDENCE:<capability>`, not failed.

**UNKNOWN blocks.** A payload with no datable timestamp cannot be aged, and treating "I could not
tell how old this is" as "it is current" is the rounding-up this codebase refuses everywhere else.

**The detail that makes the gate non-vacuous.** `geo-intelligence`'s `intel()` wrapper stamps
`generatedAt` *after* the cache read, so it is the **serve** time — a 180 s-cached result always
reports as generated a moment ago. `freshness` is set *inside* the cached builder and survives the
cache hit, so it is the real computation time. The field-priority list puts `freshness` first and
`readAt` last. Preferring `generatedAt` would have made every cached read look brand new and this
control would never have fired once. Test D9 pins that ordering.

*(The `generatedAt` naming is a real pre-existing wart: it reads as computation time and means
serve time. Not refactored — `intel()` has many consumers, the correct field already exists, and
changing it risks breaking others for no safety gain here. Recorded as a followup.)*

**Where the policy is declared, and where it deliberately is not.** Only four capabilities carry
one: `ops.zones`, `ops.coverage`, `ops.cityTwin`, `finance.anomalies` — the ones whose data is
genuinely cached or derived upstream. It was initially added to nine. The other five read Postgres
live, so the only timestamp in the payload is the one the handler just stamped: the check would
compare a clock against itself and could never fire. **A control that cannot fail is not a
control**, and claiming five more than exist would have been the more dishonest outcome.

---

## The business-coverage gaps

Ten capabilities added, each closing a question the agents provably could not answer.

| Gap | Before | Now |
|---|---|---|
| Support could not **find** a ticket | Could read one it was handed | `ticket.search` |
| No queue health | — | `support.analytics` |
| No governed escalation | Only resolve-or-nothing | `ticket.escalate` |
| Operations could see *that*, not *why* | Zone score alone | `ops.cityTwin`, `ops.coverage` |
| Partner-ops could not **find** a partner | Could inspect one it was handed | `partner.roster` |
| Finance could not see the payout pipeline | Ledger only | `finance.payoutHealth`, `finance.payoutQueue` |
| No anomaly detection | Model arithmetic or nothing | `finance.anomalies` |
| Fraud had no ranked starting point | Queue only | `fraud.highRiskUsers` |

**22 → 32 capabilities.** Nine reads, one write.

The one write is `ticket.escalate`, chosen because its failure mode points the safe way: a wrongly
escalated ticket costs a person a few minutes, where a wrong `ticket.resolve` strands a customer.
Giving an agent a governed way to hand work to a human is the opposite of giving it more autonomy.

---

## What was refused

| Considered | Refused because |
|---|---|
| `supportTicket.adminMerge` | Destructively folds one ticket into another. Detection is a read; the merge is a person's call. |
| Fraud case notes | Writing into an investigation record shapes the evidence a human later reviews. |
| `payoutOperations.approveBatch` / `retryPayout` | Money movement. §19. |
| `refundOrchestrator.executeRefund` | Money movement. §19. |
| `financialAdjustment.approve` | Direct ledger adjustment. |
| `partnerLifecycle.onApplicationApproved` | Partner eligibility. §17. |
| ETA quality, chargeback evidence, KYC state, academy progress | Real reads, but no agent has a question that needs them. **Unused reach is still reach.** |

Customer- and partner-facing surfaces remain unexposed. §66 says to expose only mature, validated,
reversible capabilities; with no production runtime and no production canary, that bar is not met.
A deliberate refusal, not an omission.

---

## A P0 the forensic pass found in my own work

The second-pass audit flagged three "money/enforcement" tools inside agent vocabularies:
`read.finance.getPayoutMetrics`, `read.finance.getPayoutQueue`, `write.support.escalateTicket`.

The detector matches a substring against the tool id and ignores category — so two **reads** that
cannot move a rupee, and a support-ticket priority bump, all tripped a P0.

**The wrong fix is to loosen the pattern.** A detector tuned until it stops complaining is a
detector that has stopped working, and the failure it guards against — a money tool quietly
entering an agent's reach — is not one to trade sensitivity for quiet.

So the pattern was **widened** (`freeze`, `revers`, `settle`, `adjust` added), and every match
inside an agent vocabulary must now appear in a written exception list with a justification.
A new check, **F3d**, asserts that list cannot launder anything: a `HIGH_RISK` tool, a
money-moving write, or a stale entry for a tool that no longer exists all fail it.

F3d was verified by breaking it — adding `high_risk.finance.refund` to the exceptions made it fail,
and restoring made it pass. The forensic suite went from 28 checks to 29, and is stricter than
before rather than quieter.

---

## Evidence

| Suite | Result |
|---|---|
| Base certification | **47 PASS / 0 FAIL** |
| Live execution | **10 PASS / 0 FAIL** |
| Integration | **14 PASS / 0 FAIL** |
| Event producers | **12 PASS / 0 FAIL** |
| E2E agentic flow | **11 PASS / 0 FAIL / 1 BLOCKED** |
| Observability self-test | **10 PASS / 0 FAIL** |
| PII & isolation | **12 PASS / 0 FAIL** |
| Chaos & concurrency | **10 PASS / 0 FAIL / 1 BLOCKED** |
| Migration guard self-test | **13 PASS / 0 FAIL** |
| Guard removal (original) | **7/7 LOAD-BEARING** |
| **Intent · clarification · freshness** | **44 PASS / 0 FAIL** |
| **Pass-4 guard removal** | **6/6 LOAD-BEARING** |
| Red team | **12 CONTAINED / 0 BREACH** |
| Forensic second pass | **29 OK / 0 FINDINGS** |
| **Total** | **236 checks, 0 failures, 2 provider-blocked** (reconfirmed at closure) |

Both BLOCKED items are the same external cause: free-tier AI provider quota (GROQ 429 → GEMINI
503). Reported as blocked, never as passed.

**Types:** backend 3 pre-existing errors (all `partner-four-axis.test.ts`), 0 attributable to this
pass. Admin panel 0 errors, build exit 0, all three agent routes emitted.

### Regression, reported honestly

`bun test` over all 141 files: **2007 pass / 30 fail / 1 error**.

All 30 failures are environmental, and none is in the agent layer:

- **21 ×** `Timed out fetching a new connection from the connection pool (connection limit: 5)` —
  tests that fire 50, 200 and 500 concurrent operations against a 5-connection pool.
- **9 ×** write conflict / deadlock, inside those same concurrency tests.
- **55 log lines ×** `Could not load the default credentials` — BigQuery, a standing blocker.

Verification that these are not regressions:

- **Zero** occurrences of "agent" anywhere in the regression log.
- `recommended-actions.integration.test.ts` — 0 fail in the sweep's tally but flagged; **37/37 pass
  in isolation**.
- `phase16-18-regression.test.ts`, the only test file importing the agent layer: failed once on a
  geofence deadlock, **5/5 pass on re-run**.
- No failing file imports `agents/`, `phase16*`, `plan-validator`, `intent` or `freshness`.

**Database isolation was verified, not assumed:** `homigo_test` took 150 bookings in the run
window; `homigo_db` took **zero**.

*(A second regression run with an explicit `NODE_ENV=test` prefix is discarded: setting it in the
shell ahead of the bunfig preload broke `.env.test` loading and the Prisma safety barrier correctly
refused to construct a client against `homigo_db`. The barrier worked; the invocation was wrong.)*
