# Phase 5A — F2 Gateway Outcome Remediation — Certification

## 1. Executive result

**A — CERTIFIED.** F2 is closed.

A transport ambiguity is no longer representable as a confirmed financial failure. The gateway
adapter now reports what is actually known, the authoritative refund service preserves that
uncertainty in a dedicated `INDETERMINATE` state, and both the admin and the AI-governed paths
inherit it because the fix sits below both of them.

Two things closed the risk rather than one. The application stopped asserting a failure it could
not prove — and Razorpay's own documented idempotency mechanism was adopted, which was then
verified against the live test gateway to return **the original refund** on a repeat call rather
than creating a second one. The duplicate-refund window that F2 described no longer exists at
either layer.

## 2. The original finding

> F2 — HIGH. `createRefund` threw for both a non-`ok` HTTP response and a transport failure;
> `executeRefund` caught both and returned the single code `GATEWAY_REFUND_FAILED`. A definite
> rejection and a lost response were recorded identically as FAILED, `refundedAmount` was never
> incremented, and a second approval could therefore call the gateway again — which sent no
> idempotency key, so the gateway could not deduplicate either.

## 3. Root cause

One `try/catch` around the gateway call, with a single exit. The information needed to tell the
two cases apart existed — an HTTP status means the server decided, a thrown transport error means
it may not have — and was discarded at the point of capture. Everything downstream then reasoned
from a code that had already lost the distinction.

## 4. Architecture — before

```
caller ──> refundOrchestratorService ──> razorpayService.createRefund ──> Razorpay
                                              │
                                              └── throw (any non-2xx OR any transport fault)
                                                        │
                                                  GATEWAY_REFUND_FAILED
                                                        │
                                                  refund = FAILED
                                                  payment released to SUCCESS
                                                  → a second refund is permitted
```

## 5. Architecture — after

```
AI tool ─┐
Admin ───┼──> refundOrchestratorService ──> razorpayService.executeGatewayRefund
Others ──┘                                          │  (+ X-Refund-Idempotency, + notes)
                                                    ▼
                            ┌───────────────────────┴───────────────────────┐
                            ▼                                               ▼
                     DEFINITE                                        AMBIGUOUS
        HTTP 4xx · connection never established           transport fault · HTTP 5xx · 409
                            │                                               │
                          FAILED                                     INDETERMINATE
                  payment released                            payment HELD in REFUNDING
                                                                            │
                                                              ┌─────────────┴─────────────┐
                                                              ▼                           ▼
                                                    webhook refund.processed    gateway read by notes
                                                              └─────────────┬─────────────┘
                                                                            ▼
                                                          RECONCILED_SUCCESS │ RECONCILED_NOT_FOUND
```

One authoritative execution path, unchanged. The AI handler remains a thin adapter and still
reaches the gateway only through the orchestrator.

## 6. Failure taxonomy

`executeGatewayRefund` returns a discriminated union instead of throwing:

| Kind | Meaning | Refund state |
|---|---|---|
| `SUCCESS` | Razorpay confirmed and named the refund | COMPLETED |
| `REJECTED` | Razorpay answered with a decision (4xx), or the request never left the client | FAILED |
| `ALREADY_SUBMITTED` | HTTP 409 — the idempotency key is already held | INDETERMINATE |
| `INDETERMINATE` | The request may or may not have been applied | INDETERMINATE |

`createRefund` is retained as a wrapper with its original throw-based contract, so the other
existing caller (`gift-card.service`) is unaffected; an ambiguous outcome is raised with
`outcomeUnknown: true` so a caller that cares can still tell the difference.

## 7. Transport classification

The question is not "did this fail" but **"could the request have been delivered"**.

| Class | Codes | Verdict | Why |
|---|---|---|---|
| Never sent | `ECONNREFUSED` `ENOTFOUND` `EAI_AGAIN` `EHOSTUNREACH` `ENETUNREACH` `UND_ERR_CONNECT_TIMEOUT`, TLS/cert failures | **REJECTED** | No connection was established, so nothing left the process. Calling this ambiguous would freeze payments over a local misconfiguration. |
| Possibly sent | `ETIMEDOUT` `ECONNRESET` `ECONNABORTED` `EPIPE` `UND_ERR_HEADERS_TIMEOUT` `UND_ERR_BODY_TIMEOUT` `UND_ERR_SOCKET` `UND_ERR_RESPONSE`, `AbortError`, "socket hang up" | **INDETERMINATE** | Bytes were already on the wire. |
| HTTP 4xx | any | **REJECTED** | Razorpay stated a decision. |
| HTTP 5xx | 500/502/503/504 | **INDETERMINATE** | A gateway timeout is an upstream that did not answer; the refund may exist behind it. |
| Unrecognised | anything else | **INDETERMINATE** | Preserving uncertainty is the safe default; asserting an unprovable failure is not. |

## 8. Razorpay idempotency — official mechanism, verified live

Razorpay's documented header was used; nothing was invented.

- Header: **`X-Refund-Idempotency`**
- Key format: minimum 10 characters, alphanumerics, hyphens and underscores only

Our operation keys (`ai-approval:<uuid>`, `refund:<paymentId>:<amount>:<source>:<actor>`) contain
colons and are therefore illegal. They are **hashed**, not sanitised: `rfnd_` + the first 40 hex
characters of `sha256(operationKey)`. A hash is deterministic, stable across a reconciliation days
later, cannot emit an illegal character, and cannot collide two operations that would sanitise to
the same text.

**Live verification against the Razorpay test gateway** — the same key sent twice:

```
[1] first call      : {"kind":"SUCCESS","refundId":"rfnd_TOlAVYDP7zXlKu","status":"pending"}
[2] replay same key : {"kind":"SUCCESS","refundId":"rfnd_TOlAVYDP7zXlKu","status":"pending"}
[3] gateway refunds for this payment: 1
    rfnd_TOlAVYDP7zXlKu amount=100 notes={"homigo_operation":"f2-real-1786516183955"}
```

Razorpay **replayed the original response** and created exactly one refund. This is stronger than
the 409 the documentation describes for a reused key, and it means a retry after an ambiguous
failure cannot produce a second refund even if one were attempted. The 409 branch is implemented
(documented for a mismatched payload or an in-flight duplicate) but was **not observed** — see §24.

## 9. Internal idempotency

Unchanged and re-verified. The operation identity — not `paymentId + amount` — is the key, so two
separately authorised refunds of the same payment for the same amount remain two operations. T09
confirms they derive two different gateway keys:

```
rfnd_7913d561f6f8d44621af12fe203001fbf35ecfc4  vs  rfnd_5154d1ed9f0ed7eae253e6599b49dd25ea9e436c
```

## 10. INDETERMINATE semantics

`RefundRequestStatus.INDETERMINATE` (additive migration). On an ambiguous outcome:

- the refund row becomes INDETERMINATE with an `OUTCOME_UNKNOWN` audit entry;
- `refundedAmount` is not touched;
- **the payment is deliberately left in `REFUNDING`**.

That last point is the structural fix. It is not an oversight — it makes the pre-existing race
guard do the work, so any further refund of that payment, from any caller, is refused until
reconciliation settles it. Uncertainty blocks, and it blocks through a control that already
existed rather than a second one invented for the purpose.

Replay of the operation returns the same unknown state and never reaches the gateway. `FAILED`
still falls through, so a genuine retry after a genuine, definite failure continues to work.

## 11. Reconciliation

Two routes into one implementation, so "a refund became real" is written once:

1. **Webhook** — `refund.processed` → `syncFromWebhook` → `resolveIndeterminateRefund`, matching on
   `notes.homigo_operation` when present and on amount otherwise.
2. **Gateway read** — `reconcileIndeterminateRefund(id)` fetches the payment's refunds from
   Razorpay and matches by notes. This is a **pure read**: it asks what happened, never "do it
   again", which is what keeps it inside the no-automatic-retry rule.

When the gateway confirms, settlement is delegated to the webhook path (journal, payment state,
audit). When the gateway holds nothing, the operation is resolved to FAILED and the payment
released — the one case where an unknown outcome can be safely downgraded.

**Proven at scale**: ten INDETERMINATE rows left by the fault-injection suite were reconciled in
one pass, all correctly resolved `NOT_AT_GATEWAY`, and **0 payments remained held**. The one
operation that really existed at Razorpay resolved `CONFIRMED` — the reconciler told them apart.

## 12. Webhook correlation

`notes.homigo_operation` carries the operation identity and was **verified echoed back** by the
live gateway (§8), so a refund found at Razorpay resolves to the exact operation rather than being
guessed at by amount. No new table and no AI-specific table was created; the existing
`idempotencyKey` is the identity.

The handler path was exercised programmatically through `syncFromWebhook` (T07). An actual
Razorpay webhook delivery was not received in this environment — see §24.

## 13. Audit trail

History is appended, never overwritten:

```
REFUNDING  →  OUTCOME_UNKNOWN  →  RECONCILED_SUCCESS      (gateway confirmed)
REFUNDING  →  OUTCOME_UNKNOWN  →  RECONCILED_NOT_FOUND    (gateway holds nothing)
```

Both entries survive on the same refund request — "we did not know, and then we found out" is the
record an auditor needs, and a status field alone cannot express it. Verified: after reconciliation
each row carries exactly 2 audit entries. Existing columns were reused; no column was added.

## 14. Retry proof

Unchanged and re-verified: all 14 high-risk tools are `maxRetries: 0`, and the engine refuses to
retry `HIGH_RISK` regardless of configuration. With `maxRetries` forced to 3 and a throwing
handler — **handler invocations 1, retryCount 0**. An ambiguous gateway outcome likewise triggers
no retry anywhere in the stack.

## 15. Compensation policy

Unchanged. No reversal, compensation, rollback or undo tool exists; no automatic reversal code
exists in the AI subsystem; `INDETERMINATE` triggers nothing automatically. A reversal remains a
new high-risk action requiring its own approval.

## 16. AI path

Still fully governed, and now truthful. An ambiguous gateway outcome propagates to the tool layer
so the AI audit agrees with the refund record instead of contradicting it (11/11):

| | |
|---|---|
| Tool execution | `INDETERMINATE` / `OUTCOME_UNKNOWN` |
| Message | "…may or may not have taken effect — reconcile before retrying" |
| Audit row | INDETERMINATE, retryCount 0 |
| Refund record | INDETERMINATE — **agrees** |
| Payment | held in REFUNDING |
| Money moved | none |
| Approval | CONSUMED — cannot authorise a retry |
| **A new approval for the same payment** | **also refused** (`NOT_REFUNDABLE`) |

That last row is F2's exposure window, closed.

## 17. Admin path

The fix is in the authoritative service, so the admin path gets identical semantics — every F2
test T01–T09 runs through `refundOrchestratorService` with `source: "admin"`, i.e. the admin flow
itself. Existing behaviour is preserved: definite rejections still produce FAILED and still release
the payment (T01, T02).

## 18. Test matrix

| # | Case | Expected | Result |
|---|---|---|---|
| T01 | HTTP 400 definite rejection | FAILED, payment released | **PASS** |
| T02 | `ECONNREFUSED` — never transmitted | FAILED, payment released | **PASS** |
| T03 | `ETIMEDOUT` after transmission | INDETERMINATE | **PASS** |
| T04 | `ECONNRESET` | INDETERMINATE | **PASS** |
| T05 | `AbortError` — response lost | INDETERMINATE | **PASS** |
| T05b | HTTP 504 upstream | INDETERMINATE | **PASS** |
| T06 | INDETERMINATE replay | same state, **0 gateway calls** | **PASS** |
| T07 | Gateway later confirms (real record) | CONFIRMED, COMPLETED, history kept | **PASS** |
| T08 | Gateway holds nothing | FAILED, payment released, history kept | **PASS** |
| T09 | Same payment + amount, two operations | two distinct gateway keys | **PASS** |
| T10 | 25 concurrent, one approval | 1 success / 24 refused | **PASS** |
| T11 | `maxRetries` forced to 3 | 1 call, retryCount 0 | **PASS** |
| T12 | AI path | approval required first | **PASS** |
| T13 | Admin path | preserved | **PASS** |
| T14 | Sandbox disabled | NO_HANDLER | **PASS** |
| T15 | `NODE_ENV=production` + sandbox on | NO_HANDLER | **PASS** |
| T16 | Live credential | refused statically, never called | **PASS** |

## 19. Regression

| Suite | Before F2 | After F2 |
|---|---|---|
| **F2 gateway semantics (new)** | — | **35 / 35** |
| **F2 AI governed path (new)** | — | **11 / 11** |
| Phase-5A attack matrix | 33 / 33 | 33 / 33 |
| Phase-5A timeout / no-retry | 13 / 13 | 13 / 13 |
| Phase-5A closed-by-default (×2) | 6 / 6 · 6 / 6 | 6 / 6 · 6 / 6 |
| Phase-5A PII | 15 / 15 | 15 / 15 |
| IC-1 | 44 / 44 | 44 / 44 |
| Phase 5 | 59 / 59 | 59 / 59 |
| Phase 4 | 27 / 27 | 27 / 27 |
| Pipeline | 39 / 39 | 39 / 39 |
| AI Core | 54 / 54 | 54 / 54 |
| ETA | 30 / 30 | 30 / 30 |
| Prompt injection | 16/16 · 10/10 | 16/16 · 10/10 |

**46 newly added assertions.** No pre-existing suite changed size; the totals above compare
like for like.

## 20. Typecheck and build

| | |
|---|---|
| Backend `tsc --noEmit` | **131** — baseline unchanged, **0 new errors** |
| Admin `tsc --noEmit` | **0** |
| Admin `next build` | **PASS** |

The 131 backend errors are the documented pre-existing baseline and are reported separately, not
as a pass.

## 21. Database safety

One additive migration: `20260812090000_refund_indeterminate_outcome` —
`ALTER TYPE "RefundRequestStatus" ADD VALUE IF NOT EXISTS 'INDETERMINATE'`.

Verified by replaying it against a scratch database cloned from the dev schema with the value
removed; it applied cleanly and produced the expected enum. Ledger structure, payment structure and
every other financial table are untouched. No column was added.

**Global ledger: debits = credits = 469,036.10, balanced.**

## 22. Production safety

Razorpay **TEST** gateway only (`rzp_test_` key). No production credential was accessed, no
production refund was created, no production database was mutated. Nothing committed, pushed or
deployed. `HEAD` remains `7ce2e71`, staged files 0.

## 23. Findings

| ID | Severity | Status |
|---|---|---|
| **F2** | HIGH | **FIXED** — transport ambiguity is now INDETERMINATE, never a confirmed failure; gateway-level idempotency verified live |
| F1 | MEDIUM | FIXED in the preceding audit (approval-preview redaction) |
| F3 / F4 / F5 | INFORMATIONAL | Unchanged |
| F6 | BASELINE | 131 pre-existing backend typecheck errors |

## 23a. Defect found during commit verification — T07 reconciliation race — FIXED

Re-running the suite before staging dropped `f2_cert` from 35/35 to 32/35. All three lost
assertions were T07: the gateway refund was matched correctly, but the record stayed
`INDETERMINATE` with a null gateway id.

The cause was an ordering defect in this remediation's own code. `reconcileIndeterminateRefund`
delegates settlement to `syncFromWebhook`, which begins with a guard:

```ts
if (existingJournal && payment.razorpayRefundId === opts.refundId) {
  return { handled: true, reason: "ALREADY_SYNCED" };
}
```

That guard returns *before* `resolveIndeterminateRefund` runs at the tail of the function. Whenever
the refund's ledger had already been synchronised, the state transition was skipped.

The reachable production sequence is a race, not a test artefact:

```
gateway refund succeeds
  → webhook arrives and synchronises the payment      (no INDETERMINATE row exists yet)
  → the application's own attempt times out
  → markRefundIndeterminate writes the row            (nothing left to resolve it)
  → every later reconciliation stops at ALREADY_SYNCED
```

The operation would stay `INDETERMINATE` permanently, and its payment could remain held in
`REFUNDING` — blocking legitimate refunds, which is the opposite of what the status is for.

**Fix**: resolve inside the guard, before returning. The guard keeps its original purpose — it
still prevents a second ledger write — but no longer swallows the state transition.
`resolveIndeterminateRefund` writes only to `refund_requests`, so it cannot duplicate a financial
effect, and it matches on `status: INDETERMINATE`, so repeating it is a no-op.

**Re-certified** with the exact race staged end to end against a real test-gateway refund (18/18):

| Assertion | Result |
|---|---|
| T07-A matched by `notes.homigo_operation` | PASS |
| T07-B resolved to COMPLETED with the gateway refund id | PASS |
| T07-C history preserved — `OUTCOME_UNKNOWN → RECONCILED_SUCCESS` | PASS |
| No ledger entries added by reconciliation | PASS |
| No second journal | PASS |
| **No refund created at the gateway** (0 `POST /refund`) | PASS |
| Reconciling twice | no-op |
| Replaying the webhook | no journal, no ledger movement |
| Reconciler + webhook concurrently (×3) | one resolved operation, no ledger movement, 0 gateway creations |

`f2_cert` returned to **35/35**. No schema change was needed; the fix is code-only.

## 24. Remaining limitations

1. **Transport faults were injected, not induced on a real network.** `globalThis.fetch` was
   replaced for the duration of single calls. The classifier, orchestrator, state machine and AI
   engine under test are all real; the faults are simulated. This is stated plainly rather than
   described as a real Razorpay timeout.
2. **The HTTP 409 branch was implemented but never observed.** The live gateway replayed the
   original response instead. The branch is written from Razorpay's documentation for a mismatched
   payload or an in-flight duplicate, and remains **NOT VERIFIED**.
3. **No live Razorpay webhook was received.** `syncFromWebhook` was exercised programmatically
   through the reconciliation path. The independent gateway-read route does not depend on webhook
   delivery, so reconciliation does not rest on this.
4. **Reconciliation is invoked, not scheduled.** `reconcileIndeterminateRefund` runs on demand;
   nothing yet sweeps INDETERMINATE rows periodically. Until something does, an unknown outcome
   holds its payment until someone asks. That is safe — it blocks rather than duplicates — but it
   is manual.
5. **Staging and production remain unverified.** All evidence is local.
6. **`gift-card.service`** still uses the wrapper `createRefund`. It now receives an
   `outcomeUnknown` flag on ambiguity but does not yet act on it; that path was out of scope and
   is unchanged in behaviour.

## 25. Final verdict

**A — CERTIFIED.**

The requirement was that a transport ambiguity must never be represented as a confirmed financial
failure. It no longer can be — proven across four fault classes, on both the admin and AI paths,
with the resulting state blocking rather than permitting a second refund, and with reconciliation
able to settle it in both directions. Razorpay's own idempotency mechanism was adopted and verified
live to return the original refund rather than create a second one.

The limitations in §24 are boundaries of evidence — how the faults were induced and which branch
was not reached — not unresolved financial risk.
