# Phase 5A — Controlled Refund Execution — Certification

**Verdict: PASS WITH LIMITATIONS.** A real refund was executed end to end through the governed
chain against the Razorpay **test** gateway. The limitations in §8 are boundaries of what was
proven, not defects found and left open.

| | |
|---|---|
| Base | `7ce2e71` — Phase-5 tool governance foundation freeze |
| Environment | Local development. `NODE_ENV=development`, Razorpay `rzp_test_` key, dev database |
| Production | Not accessed, not modified, not deployed. No production flag exists or was set |
| Date | 2026-08-11 |

## 1. What was built

Three changes, no new refund logic anywhere.

**`src/ai-tools/execution/financial-sandbox.ts`** (new) — the gate. Three independent conditions,
each sufficient on its own to refuse, all read from `process.env` at call time rather than at
import so a long-lived process cannot outlive its own environment:

1. `NODE_ENV !== "production"` — no flag overrides this.
2. `AI_TOOLS_FINANCIAL_SANDBOX === "true"` — absent means off.
3. `RAZORPAY_KEY_ID` begins `rzp_test_` — `razorpayService` does not distinguish test from live,
   so the key itself is checked. A live key cannot satisfy a sandbox run.

It also holds `SANDBOX_HIGH_RISK_ALLOWLIST`, currently exactly `high_risk.finance.refund`.

**`src/ai-tools/execution/handlers/index.ts`** — the handler, and the binding gate. The handler
contains no refund logic: what may be refunded, how much, whether the payment is refundable, how
the ledger is written and how a race resolves all remain in `refundOrchestratorService`. The
handler adds only the four things the AI layer owns — the sandbox check, the approval requirement,
the correlation identity, and turning a returned rejection into a recorded failure.

`registerToolHandlers` now binds a high-risk handler only when the tool is allowlisted **and** the
sandbox verdict allows it. Outside a sandbox nothing binds, so production behaves exactly as the
freeze left it.

**`src/ai-tools/execution/execution-engine.ts`** — two additions. A structural no-retry guard for
`HIGH_RISK` regardless of catalog configuration, and an audit row for rejected approvals (§7).

## 2. The five mandatory controls

### 2.1 Approval → handler → refund service correlation — **PROVEN**

Correlation runs through the idempotency key rather than a new column, so the financial schema was
not touched. The engine derives `ai-approval:<approvalId>` and the handler passes it straight to
`executeRefund`, which stores it on `refund_requests.idempotency_key`. The chain resolves in both
directions:

```
refund_requests.idempotency_key = "ai-approval:060995ab-…"
  → ai_tool_approvals.approval_id = 060995ab-…       (status CONSUMED)
  → ai_tool_approvals.consumed_execution_id          = d358b2fc-…
  → ai_tool_executions.execution_id = d358b2fc-…     (status SUCCESS)
```

Evidence: C1–C7 pass. The gateway refund id returned by the handler (`rfnd_TOXfnmH5nWd8ir`) is the
same one stored on the refund row.

### 2.2 Unique approval/execution-based idempotency — **PROVEN**

The approval is the deduplication identity, so two separately approved refunds for the same
payment and amount stay two distinct operations, while one approval can only ever produce one
refund. Repeat protection is enforced twice over: the approval is one-time and atomically
consumed, and beneath it the orchestrator replays a `COMPLETED` refund for a known key instead of
issuing a second one — the guarantee holds in the financial service, not only in the layer above.

Evidence: M1–M2, R1–R4. `refundedAmount` moved 0 → 1 exactly once; one refund row; re-execution
refused `APPROVAL_ALREADY_CONSUMED`.

### 2.3 Timeout → INDETERMINATE — **PROVEN**

A refund that times out is recorded `INDETERMINATE` / `OUTCOME_UNKNOWN`, never `FAILED`, and the
operator message says to reconcile rather than retry. A replay of that key returns the original
record without invoking the handler again.

Evidence: T1–T9. Forced by substituting a deliberately slow handler — the engine, approval gate,
terminal-status computation and replay path are all real; no refund was issued by that probe.

### 2.4 No automatic retry for financial execution — **PROVEN**

Configuration and structure both. All 14 high-risk tools are `maxRetries: 0`, and the engine now
refuses to retry `HIGH_RISK` whatever the catalog says — so a later edit to a catalog row cannot
silently turn one failed refund into two attempts.

Evidence: N1–N3, and T10–T12: with `maxRetries` deliberately set to 3 and a throwing handler, the
handler ran **once** and the execution recorded zero retries.

### 2.5 Sandbox-only, no production flag — **PROVEN**

| Environment | Verdict | High-risk handlers bound | Approved refund |
|---|---|---|---|
| default (flag unset) | `SANDBOX_DISABLED` | 0 | `NO_HANDLER`, nothing refunded |
| flag on, `NODE_ENV=production` | `PRODUCTION_ENVIRONMENT` | 0 | `NO_HANDLER`, nothing refunded |
| flag on, `rzp_live_` key | `GATEWAY_NOT_IN_TEST_MODE` | 0 | not reached |
| flag on, test key, development | `ALLOWED` | 1 (refund only) | executed |

Evidence: S1–S3, D1–D6 run in two environments. There is no production flag to set — production
is refused unconditionally.

## 3. The live refund

| | |
|---|---|
| Payment | `cmsim867z0170tzp8u5912hqs` (₹716) |
| Amount | ₹1 |
| Approval | `060995ab-8808-4181-a1bf-58c38aafd6c5` — requested by one admin, approved by another |
| Execution | `d358b2fc-b406-471c-93e8-377a7119da41` |
| Gateway refund | `rfnd_TOXfnmH5nWd8ir` (Razorpay test) |
| Ledger | 2 entries, debit = credit = 1, balanced |

Three refunds were executed in total across certification runs. Each has a balanced journal entry,
and the global ledger remains balanced at debits = credits = 469,031.10.

## 4. Results

| Suite | Result |
|---|---|
| Phase 5A controlled refund (live) | **30 / 30** |
| Phase 5A timeout / INDETERMINATE / no-retry | **13 / 13** |
| Phase 5A closed-by-default — flag unset | **6 / 6** |
| Phase 5A closed-by-default — production | **6 / 6** |
| IC-1 approval/execution | 44 / 44 |
| Phase 5 tool & action | 59 / 59 |
| Phase 4 memory & context | 27 / 27 |
| Context pipeline | 39 / 39 |
| AI Core | 54 / 54 |
| ETA assertions | 30 / 30 |
| Prompt injection | 16 / 16 blocked · 10 / 10 allowed |
| Backend `tsc --noEmit` | 131 — unchanged, zero new |

## 5. Frozen invariants re-verified

Every Phase-5 invariant still holds, including the ones this stage could plausibly have weakened:
approval before execution, one execution per approval, binding by tool / requester / arguments /
expiry, self-approval refused, atomic consumption, ADMIN is not approval, **consume before
handler**, absent handler fails closed, non-READ timeout is `INDETERMINATE`, `INDETERMINATE`
replays, no high-risk retry, arguments hashed not logged, high-risk never discoverable by the
model.

`consume → handler` was deliberately re-checked: D6 confirms the approval is still consumed
*before* the `NO_HANDLER` refusal, so the bindings run even when nothing can execute.

## 6. What was deliberately not done

- No new refund logic. The handler calls `refundOrchestratorService.executeRefund` and nothing
  else.
- No authoritative financial service was modified. A `source: "ai"` would have meant editing a
  financial service to add a path with no validation history, so `source: "admin"` is used —
  accurate, since a human admin approved it, and it keeps the orchestrator's own admin amount
  validation in force.
- No other high-risk handler was written. The remaining 13 still terminate at `NO_HANDLER`.
- No approval, idempotency, timeout or compensation control was weakened.
- No production anything.

## 7. Defect found and fixed during certification

**A rejected approval left no audit row.** Presenting tampered arguments against a valid approval,
or replaying a spent one, incremented a metric and threw — with nothing queryable left behind.
Those are the two attempts most worth reconstructing afterwards, and on a financial tool an
aggregate counter cannot answer who tried what, against which approval, or when.

Now recorded as a `DENIED` execution row carrying the failure code. Two things were needed to get
it right: the column is a foreign key onto the approval's *internal* id while the id travelling
through the request is the public one, and the audit write is wrapped so that a failure to record
cannot mask the refusal itself — the caller must still receive `APPROVAL_TAMPER`, not a database
error. The first attempt at this fix got both wrong and turned a clean refusal into `P2003`, which
is why X1 and X4 are now separate assertions.

## 8. Limitations

1. **Gateway-level ambiguity is not covered by `INDETERMINATE`.** If the Razorpay call itself times
   out, `executeRefund` catches it, marks the refund `FAILED` and returns `GATEWAY_REFUND_FAILED` —
   indistinguishable from a genuine rejection. The AI layer's `INDETERMINATE` guarantee covers the
   **tool-level** timeout only. Closing this means changing an authoritative financial service and
   is deliberately out of scope here.
2. **The timeout proof used an injected slow handler**, not a real gateway stall. The engine path
   is real; the stall is simulated.
3. **Refund arguments are validated in the handler, not by the catalog schema.** High-risk tools
   share a generic `payload` object schema, frozen in Phase 5. A malformed payload can therefore
   reach an approval request and fails only at execution — fail-closed, but later than ideal.
4. **Partial-refund accumulation across multiple approvals is untested.** Each certification run
   refunded ₹1 of a previously unrefunded payment.
5. **Staging and production are unverified.** All evidence is local.
6. **Three real test-mode refunds now exist in the dev database.** The affected financial tables
   were backed up before execution.

## 9. Next

Independent security certification of this handler, then — reusing this shape — account freeze,
ledger entry, wallet adjustment, payout, settlement. Each new handler needs its own sandbox
evidence; allowlist membership is per tool and deliberately not a category-wide switch.
