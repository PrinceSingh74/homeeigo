# HOMIGO — High-Risk Execution Readiness Audit

**Date:** 2026-08-11 · **Scope:** read-only audit, then targeted remediation of R1–R3.
**No handler was built.** · **Revised 2026-08-11 — see §11.**
**Purpose:** establish what must be true *before* Refund / Payout / Settlement / Wallet
Adjustment / Ledger Change / Account Freeze handlers are introduced, one at a time.

**Phase 5 certification remains: B — FIXED WITH LIMITATIONS.** Nothing here changes it.

---

## Verdict

**Original audit: NOT READY.** After remediation: **R1–R5 are all closed** (§11–§13).

Phase 5 certification stays at **B — FIXED WITH LIMITATIONS**. Closing these gaps makes the
first financial handler *safe to write*; it does not make one *exist*.

The approval *gate* was already sound — IC-1 proved every binding through the engine. What
was not ready was the **handoff from a consumed approval to a financial service**. Sections
1–10 record that original finding; §11 records what was then fixed.

| # | Finding | Severity |
| --- | --- | --- |
| R1 | Handler context cannot see the approval | **CLOSED** (§11) |
| R2 | No join key between tool audit and financial record | **CLOSED** (§11) |
| R3 | ~~3 of 8~~ **1 of 8** high-risk mappings points at nothing | **CLOSED** (§11) |
| R4 | Consume and execute are not atomic | **CLOSED** (§12) — contract enforced in code |
| R5 | No compensation path — by design, needs a stated policy | **CLOSED** (§13) — policy stated |

---

## 1. Handler registration contract

```ts
export type ToolHandlerContext = { actor: ToolActorContext; arguments: Record<string, unknown> };
export type ToolHandler = (ctx: ToolHandlerContext) => Promise<unknown>;
```

Adequate for reads. **Inadequate for money.**

**R1 — was BLOCKING, now closed (§11).** The context carried no `approvalId`, no `executionId`, and no derived
idempotency key. A refund handler therefore cannot tie its service call to the approval that
authorised it. It would have to invent its own idempotency key from the arguments, which
means two *separately approved* refunds for the same booking and amount would collide and
the second would silently replay the first — a human approval that quietly does nothing.

**Required before any financial handler:** extend `ToolHandlerContext` with `approvalId`,
`executionId`, and a deterministic `idempotencyKey` derived server-side from the approval.
This is additive and breaks no existing handler.

## 2. Approval → handler resolution ordering

Current, after the IC-1 fix:

```
policy → needsApproval check → consumeApproval (atomic, all bindings) → handler lookup → execute
```

**Correct as it stands.** Authorization decides before anything else about the request
proceeds. An earlier revision checked the handler first and short-circuited every high-risk
request to `NO_HANDLER` before its bindings were evaluated — the gate became unreachable
code. That ordering must not return; the IC-1 suite fails loudly if it does.

## 3. Consume / execution atomicity model

Two separate commits:

```
commit 1:  approval APPROVED → CONSUMED   (conditional update, one winner)
   ── no shared transaction ──
commit 2:  handler → business service → its own transaction
```

**R4 — accepted risk, with a required mitigation.** A crash between the two leaves the
approval spent and nothing done. It cannot be made atomic without opening a database
transaction across an external payment gateway call, which is worse.

The mitigation already exists in the services. `refundOrchestratorService.executeRefund()`
is genuinely production-grade: its own idempotency key, `COMPLETED` replay,
`REFUND_IN_PROGRESS` race blocking, a `$transaction` lock, and its own admin check. So a
retry is safe **provided the handler passes a deterministic key**. That is exactly why R1 is
blocking: without an approval-derived key, the retry is not deterministic.

## 4. Idempotency across execution

Two independent layers, and they currently do not meet:

| Layer | Key | Behaviour |
| --- | --- | --- |
| AI tool layer | caller `idempotencyKey`, bound to actor + tool + args | replays `SUCCESS` / `RUNNING` / `PENDING_APPROVAL` |
| Refund service | `paymentId + amount + source + actorUserId` | replays `COMPLETED`, blocks in-progress |

The AI-layer check runs **before** approval consumption. After consumption a retry receives
`APPROVAL_ALREADY_CONSUMED`, so the AI layer cannot retry at all — recovery depends entirely
on the service layer. That is acceptable *only* once R1 makes the service key derivable from
the approval.

## 5. Failure-after-consume behaviour

Today: approval is spent, `NO_HANDLER` is raised, nothing happens. Harmless, because no
handler exists.

With a real handler, four outcomes need a stated policy:

| Failure point | Money moved | Approval | Correct response |
| --- | --- | --- | --- |
| Before gateway call | no | spent | Re-approve. Service key blocks a double later. |
| Gateway timeout, unknown | **unknown** | spent | Reconcile against the gateway. **Never auto-retry.** |
| Gateway succeeded, our write failed | **yes** | spent | Service replay repairs it. Must not re-approve. |
| After full success | yes | spent | Nothing. |

Row two is the one that matters. A timeout is not a failure, and treating it as one is how
double refunds happen. The handler must surface `UNKNOWN`, never a clean failure.

## 6. Transaction / compensation strategy

`financial-ledger.service` is journal-based — `recordJournal`, `recordJournalInTransaction`,
`recordRefund`. Append-only with reversal entries, never delete-and-rollback. **This is the
right model** and the AI layer must not attempt to compensate.

**R5 — needs a decision.** A partially applied financial action is corrected by a *new,
separately approved reversal*, not by an automatic rollback. That means the reversal itself
is a high-risk action requiring its own human approval. This should be written down before
the first handler ships, or someone will build a silent auto-reversal.

## 7. Financial action audit requirements

Two trails exist and **cannot currently be joined**:

```
ai_tool_executions   executionId, toolId, actorId, argumentsHash, policyDecision, traceId
refundRequest        idempotencyKey, gatewayRefundId, status, amount
ledger journal       double-entry rows
```

**R2 — was BLOCKING, now closed (§11).** Nothing linked an `executionId` to the `refundRequest` or journal rows it
produced. After an incident, "which AI-approved action moved this money" is unanswerable
without manual timestamp correlation. Fix with a correlation column or a deterministic
idempotency key that embeds the execution id — the second is cheaper and also solves R1.

## 8. Authorization boundaries of the real services

| Tool | Declared mapping | Reality |
| --- | --- | --- |
| Refund | `finance.service.refund` | `refundOrchestratorService.executeRefund` — **exists, production-grade** |
| Payout | `settlement.service.payout` | `financial-integrity.service` — exists, needs review |
| Ledger entry | `finance.service.ledger` | `financial-ledger.service` — exists, journal-based |
| Account freeze | `financialRisk.service.applyHold` | `financial-risk.service.applyHold` — **exists** |
| Customer ban | `admin.service.banUser` | `admin.service` — exists |
| Wallet adjustment | `financialAdjustment.service.execute` | **exists — has its own maker-checker** |
| Settlement sync | `settlementSync.service.runSync` | **exists** |
| **Partner suspend** | `admin.service.suspendProvider` | **DOES NOT EXIST — tool now INACTIVE** |

**R3 — corrected during remediation, and the original finding was overstated.** The audit's
first pass used a search pattern that produced false negatives on two of the three. Verified
individually:

- `wallet.service.adjust` → **`financialAdjustmentService.execute()` exists**, with its own
  maker-checker chain (`create` → `approve` → `execute`). The label was wrong, not the
  service.
- `settlement.service.sync` → **`settlementSyncService.runSync()` exists.** Label only.
- `admin.service.suspendProvider` → **genuinely absent.** `admin.service` has `banUser` and
  `verifyProvider`; nothing suspends a provider.

Only one tool was actually orphaned. Reporting three was an over-claim on my part.

Note also that `executeRefund` enforces `isAdmin` itself. The AI layer's RBAC is therefore a
second gate, not the only one — good, and it must stay that way. A handler must not bypass
the service's own authorization by calling a lower-level function.

## 9. Approval expiry and race behaviour

| Property | State |
| --- | --- |
| Expiry window | 24 h default (`AI_TOOL_APPROVAL_EXPIRY_HOURS`) |
| Expiry checked at decision | yes |
| Expiry checked **at consumption** | yes — proven (IC-1 T5) |
| Concurrent consumption | exactly one winner — proven (IC-1 T8) |
| Expiry *during* execution | not applicable — consumption already committed |

**24 h is too long for a financial action.** An approval granted this morning should not
still authorise a refund tonight, after the booking state has moved. Recommend 15–60 minutes
for `high_risk.finance.*`, configured per risk level rather than globally.

## 10. Contract a future handler must satisfy

Before the first financial handler is registered:

1. **`ToolHandlerContext` carries `approvalId`, `executionId`, and a server-derived
   `idempotencyKey`.** (closes R1 and R2)
2. **The handler passes that key to the service** — it never invents its own.
3. **The handler calls the authoritative service**, never a lower-level function that skips
   the service's own authorization and transaction.
4. **The handler never computes an amount.** It passes what was approved; the service
   resolves authoritative values.
5. **A gateway timeout surfaces as `UNKNOWN`, never as a failure**, and never auto-retries.
6. **Reversal is a separate approved action.** No automatic compensation.
7. **Per-tool expiry** is set before the tool goes live.
8. **The tool is registered only when its service exists.** Fix or deactivate the three
   phantom mappings first.

### Suggested order of introduction

Refund first — it is the only target with proven idempotency, race blocking and a
transaction lock, so it exercises the whole path with the strongest service beneath it.
Then account freeze (no money moves). Then ledger entry. Payout, settlement and wallet
adjustment last, and only after their services are reviewed or written.

---

## Regression status at the time of this audit

| Suite | Result |
| --- | --- |
| IC-1 | 28 / 28 |
| Phase 5 · Phase 4 · pipeline · AI core · ETA | 59/59 · 27/27 · 39/39 · 54/54 · 30/30 |
| Injection | 16/16 blocked · 10/10 benign |
| Backend typecheck · Admin typecheck | 83 (baseline) · 0 |
| `next build` | ✓ compiled |

No file was modified by this audit.

---

## 11. Remediation applied (2026-08-11)

**R1 + R2 — `ToolHandlerContext` now carries the authorisation.**

```ts
{ actor, arguments, executionId, approvalId?, idempotencyKey }
```

`idempotencyKey` is derived server-side, never taken from the caller and never invented by
the handler:

```
approvalId present  →  ai-approval:<approvalId>
otherwise           →  caller key, else ai-exec:<executionId>
```

Anchoring on the approval — not the arguments — is the point. Two separately approved
refunds for the same booking and amount are two distinct operations; an argument-derived key
would collapse them and the second human approval would silently do nothing. The key also
embeds the approval or execution id, so the resulting `refundRequest` or journal row can be
joined back to the AI action that caused it, which is what R2 asked for.

**R3 — mapping honesty.** Two labels corrected to name the services that actually exist.
`high_risk.compliance.partnerSuspend` is now `status: INACTIVE`: still registered, still
approval-gated, but refusing with `TOOL_DISABLED` before anything else rather than
advertising a mapping a handler author would follow into a dead end.

**A note for whoever writes the wallet-adjustment handler.** `financialAdjustmentService`
already has an independent maker-checker chain. That means two approval chains would govern
one action. That is defence in depth, not a bug — but it needs a deliberate decision about
which one is authoritative, or someone will eventually route around one of them.

**Verification:** IC-1 suite extended to **37/37**, covering the handler context (R1a–R1d),
the audit join key (R2a) and mapping honesty (R3a–R3d). Full regression unchanged:
Phase 5 59/59 · Phase 4 27/27 · pipeline 39/39 · AI core 54/54 · ETA 30/30 ·
injection 16/16 + 10/10 · backend typecheck 83 (baseline).

**Still open:** R4 (consume and execute are not atomic — accepted, mitigated by the derived
key) and R5 (compensation policy — needs a written decision before the first handler).

---

## 12. R4 — the execution / consume contract (closed)

The gap was not the missing transaction. It was that **every terminal state asserted an
outcome**: `SUCCESS` meant it happened, `FAILED` and `TIMEOUT` meant it did not. For a
side-effecting call that timed out mid-flight, neither is true — the gateway may have moved
the money and simply not answered.

Recording that as `FAILED` is the double-refund path: an operator reads "failed", approves
again, and the second attempt lands beside a first one that also succeeded.

### The contract, now enforced

| Situation | Recorded as | Retry allowed |
| --- | --- | --- |
| Side-effecting call times out mid-flight | **`INDETERMINATE` / `OUTCOME_UNKNOWN`** | **No** |
| Same idempotency key returns after an indeterminate result | replayed as `INDETERMINATE` | **No** |
| Read times out | `TIMEOUT` | Yes — re-reading is free |
| Genuine failure before any side effect | `FAILED` | Yes |

An indeterminate result is cleared by **reconciling against the downstream system**, never by
another attempt through the tool layer. `homigo_ai_tool_indeterminate_total` should sit at
zero; any sustained non-zero rate means something may have been applied without confirmation
and deserves a look.

Retry configuration was audited at the same time: `maxRetries > 0` on all 29 READ tools
(safe), on exactly 2 notification WRITE tools (a duplicate notification, not a duplicate
financial effect), and on **zero** high-risk tools.

**Verified:** IC-1 R4a–R4e.

## 13. R5 — the compensation contract (closed)

**A partially applied financial action is corrected by a new, separately approved reversal.
Never by an automatic rollback.**

This follows from the ledger design rather than from preference. `financial-ledger.service`
is journal-based — append-only with reversal entries. There is no delete-and-rollback to
call, and inventing one at the AI layer would put a second, weaker write path next to the
authoritative one.

Consequences, stated so nobody has to infer them:

1. The AI layer performs **no compensation of any kind**. It has no reversal tool, and one
   must not be added.
2. A reversal is itself a high-risk action. It needs its own approval, its own binding and
   its own audit trail — the original approval does not authorise undoing the thing it
   authorised.
3. An `INDETERMINATE` outcome is **not** grounds for a reversal. Reconcile first; reverse
   only once you know what actually happened.
4. Compensation therefore always involves a human twice: once to decide a reversal is
   warranted, once to approve it.

**Verified:** IC-1 R5a (no auto-reversal tool exists anywhere in the registry), R5b (every
high-risk capability still demands its own approval).

## 14. Readiness status after R1–R5

| Gap | State |
| --- | --- |
| R1 handler context | **CLOSED** |
| R2 audit join key | **CLOSED** |
| R3 mapping honesty | **CLOSED** |
| R4 execution/consume contract | **CLOSED** |
| R5 compensation contract | **CLOSED** |

**The foundation is ready for the first financial handler.** Phase 5 certification remains
**B — FIXED WITH LIMITATIONS**: a handler is now *safe to write*, and still does not exist.

Recommended order, unchanged: **Refund** first (the only target with proven idempotency,
race blocking and a transaction lock beneath it), then Account Freeze, then Ledger Entry.
Payout, Settlement and Wallet Adjustment last — and Wallet Adjustment only after deciding
which approval chain is authoritative, since `financialAdjustmentService` has its own.

**IC-1 suite: 44/44.**
