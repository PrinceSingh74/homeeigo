# Phase 5A — Independent Security & Financial Execution Certification

## 1. Executive verdict

**B — PASS WITH LIMITATIONS.**

The governed refund path is sound. Every approval control was independently attacked and held:
the approval cannot be bypassed, substituted, replayed, widened, or raced. Financial execution
cannot be duplicated, cannot retry, and cannot run outside a sandbox. One real defect was found
and fixed during this audit (§23 F1).

The limitation is not in Phase-5A. It is inherited: **the payment gateway's ambiguous outcomes are
indistinguishable from its definite rejections**, which leaves a real — if narrow and
compensated — double-refund window. That is proven, not assumed (§10), and it is not upgraded to
PASS.

| Control | Result |
|---|---|
| Financial execution | **PASS** (sandbox, live gateway, real money moved and reconciled) |
| Razorpay uncertain outcome | **NOT VERIFIED** — defect proven, see §10 |
| Approval bypass | **PASS** — 10 attack vectors, all refused |
| Idempotency | **PASS** |
| No retry | **PASS** — structurally enforced |
| Sandbox | **PASS** |
| Audit correlation | **PASS** — both directions |
| Production safety | **PASS** |

## 2. Scope and method

Independent re-derivation. No prior Phase-5A claim was accepted as evidence; every control was
reproduced through the real engine against the real database and the real Razorpay **test**
gateway. Source reading was used to locate controls, never to certify them.

Fault injection was confined to test harnesses — a slow handler, a throwing handler, and a
monkey-patched `razorpayService.createRefund` restored immediately after. No authoritative
financial service was modified to make a test pass.

## 3. Baseline

`7ce2e715f6f2972f93c85ba4a6c7899caa122bdd` — Phase-5 tool governance foundation freeze.

## 4. Phase-5A changed files

Verified against the baseline; none contains unrelated work.

| File | Change |
|---|---|
| `src/ai-tools/execution/financial-sandbox.ts` | new — the three-condition sandbox gate |
| `src/ai-tools/execution/handlers/index.ts` | +92 — the refund handler and the binding gate |
| `src/ai-tools/execution/execution-engine.ts` | +59/−2 — denial audit row, structural no-retry |
| `src/ai-tools/security/tool-security.ts` | **modified by this audit** — redaction fix (§23 F1) |
| `docs/phase5-evidence/PHASE-5A-*.md` | new — evidence |

`tool-security.ts` is part of the frozen commit. It was changed deliberately: the fix strengthens
data handling and reopens none of the frozen contracts (approval binding, `INDETERMINATE`
semantics, compensation policy).

Everything else in the worktree is pre-existing and was left untouched.

## 5. Threat model

An adversary with (a) the ability to issue AI tool requests as an admin, (b) knowledge of a valid
approval id, and (c) in one probe, direct database write access. The asset is money leaving the
platform. The controls under test are the approval gate, the idempotency identity, the sandbox
gate, and the audit trail.

## 6. Approval attack matrix — 33/33

| # | Attack | Result | Approval spent? | Money moved? |
|---|---|---|---|---|
| A | Valid approval, exact arguments | SUCCESS | yes, once | ₹1, once |
| B | Approval for refund used on `walletAdjustment` | `APPROVAL_WRONG_TOOL` | no | no |
| C | Different actor spends A's approval | `APPROVAL_WRONG_ACTOR` | no | no |
| D | Amount widened 1 → 100 | `APPROVAL_TAMPER` | no | no |
| E | `paymentId` substituted | `APPROVAL_TAMPER` | no | no |
| F | Expired approval | `APPROVAL_EXPIRED` → status EXPIRED | no | no |
| G | Requester approves own request | `SELF_APPROVAL_DENIED`, stays PENDING | no | no |
| H | Replay of a spent approval | `APPROVAL_ALREADY_CONSUMED` | already spent | no |
| I | `argumentsPreview` rewritten in the DB, hash left alone | `APPROVAL_TAMPER` | no | no |
| J | `argumentsHash` rewritten in the DB to match attacker args | gate passed | yes | **no** — service rejected |

**I is the important one.** Rewriting the preview does not widen authorisation: the hash remains
the sole binding, so a doctored preview shown to an approver still cannot authorise the doctored
arguments.

**J is a deliberate root-of-trust probe.** Direct write access to `ai_tool_approvals.arguments_hash`
defeats the binding, because the stored hash *is* the authorisation. This is a property of the
design, not a flaw in it — an attacker who can rewrite that column can also rewrite the approval
status. Recorded as INFORMATIONAL (§23 F3). Even then no money moved: the financial service
rejected the substituted payment on its own rules.

## 7. Concurrency — 25 simultaneous executions of one approval

```
outcomes: { "SUCCESS": 1, "APPROVAL_ALREADY_CONSUMED": 24 }
```

| Assertion | Result |
|---|---|
| Exactly one execution succeeded | 1 |
| All others refused | 24/24 |
| Refund rows for that approval | exactly 1 |
| `refundedAmount` | 0 → 1 (moved once) |
| Gateway refund | `rfnd_TOZp9dzSBluxpq`, COMPLETED |
| Approval | CONSUMED once |

Database state was verified directly, not inferred from return values. The atomic
`updateMany … where status='APPROVED'` produces exactly one winner under real contention.

## 8. Idempotency — 4/4

The authoritative key is approval-anchored (`ai-approval:<approvalId>`), confirmed on the stored
refund row. Two different approvals carrying **identical** arguments derive different keys and
remained two distinct operations — payment `cmsfvj6rw…` ends at `refundedAmount = 2` from two ₹1
refunds with two gateway ids. They did not collapse into one merely because the arguments matched,
and the first refund row was untouched by the second.

## 9. Timeout / unknown outcome — 13/13

A tool-level timeout on a side-effecting call is recorded `INDETERMINATE` / `OUTCOME_UNKNOWN`, with
an operator message directing reconciliation rather than retry. Replaying the same key returns the
original record and **does not invoke the handler again** (verified with an instrumented handler
that would have flipped a flag). `retryCount = 0`. The approval is spent, so it cannot authorise a
second attempt.

## 10. Razorpay uncertain outcome — **NOT VERIFIED**

This was tested, not reasoned about. `razorpayService.createRefund` was patched in a harness to
raise (1) a definite gateway rejection and (2) an ambiguous network fault, and the resulting system
state compared.

| | Definite rejection (HTTP 400) | Ambiguous fault (`ETIMEDOUT`) |
|---|---|---|
| Tool execution | FAILED | FAILED |
| `refund_requests` | FAILED | FAILED |
| `refundedAmount` | 0 | 0 |

**The two are recorded identically.** Answering the audit's five questions:

1. **Can the system distinguish confirmed rejection from unknown outcome?** No. `createRefund`
   throws for both a non-`ok` HTTP response and a transport failure; `executeRefund` catches both
   and returns the single code `GATEWAY_REFUND_FAILED`.
2. **Can Razorpay have accepted the refund while the application believes it failed?** Yes — if the
   request was transmitted and the response lost.
3. **Can an operator then retry and create a second refund?** Yes. `refundedAmount` was never
   incremented, so `validateAdminRefundAmount` still permits the full amount (verified:
   `{"ok":true}`). The spent approval blocks *that* approval from retrying, but a new approval
   derives a new idempotency key and calls the gateway again — and `createRefund` sends **no
   idempotency key to Razorpay**, so the gateway cannot deduplicate either.
4. **Is there a reconciliation mechanism?** Partially, and it is real:
   - A `refund.processed` webhook is wired (`payment.service` → `refundLedgerSyncService`) and does
     repair local state — it writes the ledger journal, sets `REFUNDED`, and raises
     `refundedAmount`, which then closes the window in (3). It requires
     `RAZORPAY_WEBHOOK_SECRET` (present in this environment; absent means webhooks are rejected 401).
   - `gatewayReconciliationService` fetches the last 100 Razorpay refunds and flags any that do not
     match local state. It is **admin-triggered, not scheduled**, and **records** discrepancies
     rather than repairing them.
   - Neither repairs the AI-side `refund_requests` row. After a confirmed-moved-but-recorded-failed
     refund, the AI correlation chain continues to read FAILED.
5. **Is the current behaviour safe?** Not provably. The exposure is narrow — it needs an ambiguous
   fault, then a second approval inside the window before the webhook lands — and it is
   compensated, but it is real.

**Not fixed, deliberately.** The fix belongs in `razorpayService`/`refundOrchestratorService`
(distinguish transport faults, send a gateway idempotency key), which are authoritative financial
services shared by the existing non-AI admin refund path. This defect is **pre-existing and
identical there** — Phase-5A did not introduce it and cannot repair it from the AI side, because
the handler receives the same undifferentiated `GATEWAY_REFUND_FAILED`. Changing them is a broader
financial-hardening task, explicitly out of Phase-5A scope.

## 11. Retry proof — PASS

Configuration: all 14 high-risk tools are `maxRetries: 0`.

Structure: the engine refuses to retry `HIGH_RISK` regardless of configuration. Proven hostilely —
`maxRetries` was set to 3 with a throwing handler:

```
handler invocations: 1        retryCount recorded: 0        status: FAILED
```

Convention alone would not survive a future catalog edit; this does.

## 12. Sandbox proof — PASS

| Environment | Verdict | High-risk handlers bound | Approved refund |
|---|---|---|---|
| flag unset (default) | `SANDBOX_DISABLED` | 0 | `NO_HANDLER`, nothing refunded |
| flag on, `NODE_ENV=production` | `PRODUCTION_ENVIRONMENT` | 0 | `NO_HANDLER`, nothing refunded |
| flag on, `rzp_live_` key | `GATEWAY_NOT_IN_TEST_MODE` | 0 | not reached |
| flag on, test key, development | `ALLOWED` | 1 (refund only) | executed |

The live-credential case was verified **statically** — a live-shaped key was supplied to the gate,
which refused before any network call. No live credential was used or accessed.

Searched for and found **no** bypass: no production refund flag, no debug or test-mode override, no
"force" path. Production is refused unconditionally; there is no flag that enables it.

## 13. Direct-write bypass audit — PASS

Across `src/ai`, `src/ai-tools`, `src/ai-brain`:

- **Exactly one** AI → financial write path: `handlers/index.ts:292` →
  `refundOrchestratorService.executeRefund`, inside the governed handler.
- **Zero** direct Prisma writes to `refundRequest`, `payment`, `ledgerEntry`, `journalEntry`,
  `walletTransaction`, `payout` or `settlement`.
- **Zero** imports of `razorpay.service` anywhere in the AI subsystem — there is no AI → gateway path.
- `ai-brain` context collectors touch `refundRequest` with `count`/`findMany` only — read-only
  context, correctly not classified as a bypass.
- Catalog references to `financialAdjustment.service.execute` and `settlementSync.service.runSync`
  are metadata strings, not call sites; those tools remain unbound.

## 14. Audit correlation — PASS, both directions

Forward, from an approval:

```
approval=23b4c91b-… status=CONSUMED exec=f704b5d3-…
  | tool_exec=SUCCESS | refund=COMPLETED rs.1 gw=rfnd_TOZpCCg5AB2dgp
```

Reverse, from money:

```
refund=rfnd_TOZpCCg5AB2dgp -> approval=23b4c91b-…
  requested_by=cmq70wb940331… approved_by=cmq70wb7b032x… consumed_exec=f704b5d3-…
```

Both joins are on stored identifiers — no timestamp guessing. The reverse direction yields the
requester **and** the approver, so a refund is attributable to two named humans. The two
gateway-failure probes correctly resolve to `tool_exec=FAILED / refund=FAILED / gw=-`, with no
phantom gateway id.

## 15. Denial audit — PASS

Every refusal now leaves a queryable `DENIED` row:

| Failure | Audit rows |
|---|---|
| `APPROVAL_WRONG_TOOL` | 1 |
| `APPROVAL_WRONG_ACTOR` | 1 |
| `APPROVAL_TAMPER` | 4 |
| `APPROVAL_EXPIRED` | 1 |
| `APPROVAL_ALREADY_CONSUMED` | 25 |

A refusal also stays a refusal: the audit write is wrapped so that a failure to record cannot
convert `APPROVAL_TAMPER` into a database error. This was verified against a real regression — an
earlier revision of that audit path wrote to a foreign key with the wrong id and surfaced `P2003`
to the caller, hiding the security reason. That is now impossible by construction.

## 16. PII / payment-data audit — defect found and fixed

See §23 F1. After the fix, 15/15: card numbers, CVV, passwords, tokens, UPI VPAs, bank accounts,
Aadhaar, OTPs and API keys are redacted at any depth including inside arrays, and card-shaped
values are scrubbed from free text. Authorisation remains by hash; the preview is display-only and
was re-verified as unable to widen an approval (attack I).

Redaction was checked for over-reach as well: a realistic refund preview still shows `paymentId`,
`bookingId`, `amount`, `reason` and `currency` in full. A preview that redacts everything teaches
reviewers to ignore redaction.

## 17. Existing refund service integrity — PASS

Unchanged since the baseline, verified by diff:

`refund-orchestrator.service.ts` · `razorpay.service.ts` · `payment-refund-rules.ts` ·
`financial-ledger.service.ts` · `financial-transaction-manager.service.ts` ·
`refund-ledger-sync.service.ts`

The handler remains a thin adapter: sandbox gate, approval assertion, argument extraction,
correlation identity, service call, rejection-to-failure translation. It contains no amount
validation, no refundability rules, no ledger writing, no locking and no race handling — all of
that stays in the orchestrator, which continues to enforce its own `isAdmin` check, its own
`COMPLETED` replay, its own `REFUND_IN_PROGRESS` block and its own `SELECT … FOR UPDATE`.

## 18. Financial state — PASS

| Refund | Payment | Paid | Refunded | Gateway |
|---|---|---|---|---|
| COMPLETED ₹1 | `cmso9dhmz…` | ₹403 | ₹1 | `rfnd_TOXbkmfsdrmD4a` |
| COMPLETED ₹1 | `cmsjyiayf…` | ₹690 | ₹1 | `rfnd_TOXd8YfRNl5O4y` |
| COMPLETED ₹1 | `cmsim867z…` | ₹716 | ₹1 | `rfnd_TOXfnmH5nWd8ir` |
| COMPLETED ₹1 | `cmsfvj6rw…` | ₹799 | ₹2 | `rfnd_TOZp9dzSBluxpq` |
| COMPLETED ₹1 | `cmsfvj6rw…` | ₹799 | ₹2 | `rfnd_TOZpCCg5AB2dgp` |
| FAILED ₹1 | `cmse9d7y8…` | ₹505 | ₹0 | no gateway call |
| FAILED ₹1 | `cmse9d7y8…` | ₹505 | ₹0 | no gateway call |

Five real ₹1 refunds on the test gateway; the two failures are the §10 probes and correctly moved
nothing. `cmsfvj6rw…` carries two refunds totalling exactly ₹2 from two distinct approvals — the
intended behaviour, not a duplication.

**Global ledger: debits = credits = 469,033.10, balanced** — exactly ₹2 above the pre-audit total,
matching the two refunds this audit issued.

## 19. Compensation policy — PASS

No reversal, compensation, rollback or undo tool exists in the catalog. No automatic reversal code
exists anywhere in the AI subsystem. `INDETERMINATE` triggers nothing automatically. A reversal
would require a new high-risk action with its own approval — the original approval is CONSUMED and
cannot authorise it.

## 20. Regression — PASS

| Suite | Result |
|---|---|
| Phase-5A attack matrix (this audit) | **33 / 33** |
| Phase-5A gateway ambiguity (this audit) | **8 / 8** |
| Phase-5A PII (this audit, after fix) | **15 / 15** |
| Phase-5A timeout / INDETERMINATE / no-retry | 13 / 13 |
| Phase-5A closed-by-default — flag unset | 6 / 6 |
| Phase-5A closed-by-default — production | 6 / 6 |
| IC-1 | 44 / 44 |
| Phase 5 | 59 / 59 |
| Phase 4 | 27 / 27 |
| Pipeline | 39 / 39 |
| AI Core | 54 / 54 |
| ETA | 30 / 30 |
| Prompt injection | 16 / 16 blocked · 10 / 10 allowed |

All re-run **after** the redaction fix.

## 21. Migration safety — PASS

`prisma/schema.prisma` unchanged since the baseline. No new migration was created. No financial
table was altered. `CONSUMED`, `INDETERMINATE`, the approval fields and the execution fields are
intact and in use — every one of them was exercised by the tests above.

## 22. Production safety — PASS

Nothing committed, nothing pushed, nothing deployed. `HEAD` remains `7ce2e71`, staged files 0.
Production database, secrets and configuration were not accessed. No live financial credential was
used; the live-key case was proven statically. No production feature flag exists to enable, and
`NODE_ENV=production` is refused unconditionally.

## 23. Findings

**F1 — MEDIUM — Sensitive data survived into the stored approval preview. FIXED.**
`redactArguments` matched only `password|secret|token|ssn|pan|card|cvv|pin` on key names, **never
recursed into arrays**, and did not inspect string values. Proven leaking: UPI VPA, bank account,
account number, Aadhaar, OTP, API key; every field inside `instruments: [{cardNumber, cvv, upi}]`
including ones that would have been redacted at object level; and a card number written into a
free-text `reason`. This data is stored in `ai_tool_approvals.arguments_preview` and rendered in
the admin approval queue. Not an authorisation weakness — the hash binding was re-verified
unaffected — but a real data-at-rest exposure on the one tool that carries payment arguments.
Fixed by broadening the key pattern to Indian payment rails, recursing arrays, and scrubbing
Luhn-valid card-shaped values from free text. 15/15, no over-redaction.

**F2 — HIGH — Gateway ambiguous outcome is indistinguishable from definite rejection. NOT FIXED
(out of scope), NOT VERIFIED.** See §10. Pre-existing, shared with the non-AI admin refund path,
compensated but not eliminated.

**F3 — INFORMATIONAL — Database write access defeats the approval binding.** Rewriting
`arguments_hash` widens an approval, because the stored hash is the authorisation. Inherent to the
design; an attacker at that level can rewrite the approval status too. No money moved in the probe.

**F4 — INFORMATIONAL — The handler accepts two argument shapes** (`args.payload ?? args`). Not a
widening vector: the approval hash covers the entire arguments object whichever shape is used.

**F5 — INFORMATIONAL — High-risk tools share a generic `payload` object schema** (frozen in
Phase 5). A malformed refund payload can reach an approval request and fails only at execution.
Fail-closed, but later than ideal — an approver can be asked to review a request that can never run.

**F6 — BASELINE — 131 pre-existing backend typecheck errors.** Unchanged by Phase-5A and by this
audit. Reported separately, not counted as a pass.

## 24. Remediations applied by this audit

| Finding | Fix | Verification |
|---|---|---|
| F1 | `redactArguments`: broadened key pattern, array recursion, Luhn-checked free-text scrub | PII probe 15/15; over-redaction check; full regression re-run |

No other code was changed. No unrelated cleanup was performed.

## 25. Known limitations

1. **Razorpay ambiguous outcome (F2)** — the headline limitation. Not provably safe.
2. **Reconciliation is manual and detect-only.** `gatewayReconciliationService` runs from an admin
   route, examines the last 100 gateway refunds, and records issues without repairing them.
3. **The webhook never repairs the AI-side refund row.** After a confirmed-moved-but-recorded-failed
   refund, `refund_requests` and the AI correlation chain keep reading FAILED.
4. **Timeout evidence used an injected slow handler**, not a real gateway stall.
5. **Partial-refund accumulation across many approvals** is proven only to depth two.
6. **Staging and production are entirely unverified.** All evidence is local.
7. **Seven AI-originated refund rows now exist in the dev database** (five real ₹1 refunds on the
   test gateway, two deliberate failures). Financial tables were backed up beforehand.

## 26. Final certification verdict

**CERTIFICATION: B — PASS WITH LIMITATIONS**

The Phase-5A architecture is sound and its controls are real. Ten approval attack vectors were
refused, twenty-five concurrent executions of one approval produced exactly one refund, financial
execution cannot retry or escape the sandbox, and every refusal is now auditable. One genuine
defect was found and fixed.

Certification stops short of A because a financial system cannot be called certified while it
cannot tell "the gateway said no" from "we never heard back". That defect is inherited rather than
introduced, its production exposure today is zero because production execution is refused
unconditionally, and it is compensated by a wired webhook and an existing reconciliation service —
but it is not closed, and it should be closed before any non-sandbox financial execution is
considered.
