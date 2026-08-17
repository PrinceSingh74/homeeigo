# HOMEEIGO PHASE 6E' REMEDIATION CERTIFICATION

**Date:** 2026-08-17
**Scope:** close the open items left by Phase 6E' (Notification Platform Foundation). No 6C, 6D or 6G functionality.
**Git state:** HEAD `a1f2493`, 0 staged, nothing committed, pushed or deployed. Production untouched.

---

## 1. Executive Result

**PASS WITH LIMITATIONS.**

Every remediation item was closed, and the work turned up **one real defect that the original 6E' certification had not caught**: the idempotency guard did not actually stop duplicate sends. It is fixed and the fix is proven across real OS processes. The limitations are unchanged from 6E' and are all external: no provider credentials, and no receipt mechanism anywhere in the platform, so *delivery* remains unverifiable by construction.

| Item | Result |
|---|---|
| Idempotency correctness under concurrency | **PASS** — defect found and fixed |
| Multi-process verification | **PASS** |
| p6e_cert determinism | **PASS** (one nondeterminism source removed) |
| Reproducibility campaign (40 runs) | **PASS** |
| Provider delivery | **NOT VERIFIED** — no credentials, no receipts |
| HTML email | **OUT OF SCOPE** (deliberate) |
| Regression / typecheck / build | **PASS** |
| Database integrity | **PASS** |

---

## 2. Remaining Gaps

The audit opened with five candidate gaps. Their disposition:

| Gap | Disposition |
|---|---|
| Provider delivery not verifiable | **NOT VERIFIED** — external blocker, see §3 |
| `p6e_cert` one-time 42/1 anomaly | **NOT REPRODUCED** — see §5, §6 |
| HTML email absent | **OUT OF SCOPE** — see §7 |
| PII decryption failure as anomaly cause | **RULED OUT** — all 296 users resolved, 0 threw |
| Orphan providers as anomaly cause | **RULED OUT** — 0 found |

One gap was **not** on the list and was found during verification: see §4 and §11.

---

## 3. Provider Delivery Verification

**NOT VERIFIED.** This is a factual statement about the environment, not a soft pass.

Credential state (names only, no values read or printed):

| Variable | State |
|---|---|
| `RESEND_API_KEY` | NOT SET |
| `EXPO_ACCESS_TOKEN` | NOT SET |
| `TWILIO_ACCOUNT_SID` | SET |
| `TWILIO_PHONE_NUMBER` | SET |
| `AUTOMATION_SMS_ENABLED` | NOT SET (SMS therefore off) |

Even with credentials, **no receipt mechanism exists in this codebase**:

- `getReceiptsAsync` — **ABSENT**. Expo returns a *ticket*, which is acceptance, not receipt.
- Twilio `statusCallback` — **ABSENT**.
- The Resend webhook handles bounce and complaint only, and writes to `EmailLog` and the suppression list — **never** to `NotificationDelivery`.

Consequently the platform can honestly record `QUEUED` and `SENT`, and **cannot** record `DELIVERED`. Nothing in this remediation claims otherwise. Building a receipt pipeline is a genuine piece of work, not a configuration change, and was not in the approved scope.

---

## 4. Delivery Status Semantics

One status was added: **`PENDING`** — *claimed, not yet attempted*.

| Status | Meaning |
|---|---|
| `PENDING` | Operation claimed by exactly one process. Nothing sent yet. |
| `QUEUED` | Handed to the provider; acceptance confirmed, receipt not. |
| `SENT` | Provider confirmed it sent. |
| `DELIVERED` | Provider confirmed recipient receipt. **Never written today** — see §3. |
| `FAILED` / `UNAVAILABLE` / `SKIPPED` | Unchanged. |

`PENDING` exists because of the defect in §11. It is deliberately excluded from `ChannelSendResult` — an adapter can never return it, so no provider outcome can ever be confused with a claim.

Two new reason codes ride with it: `CLAIM_IN_FLIGHT` (someone else owns this operation right now) and `CLAIM_RECOVERED` (the previous owner died and the lease was taken over).

---

## 5. p6e_cert Anomaly Investigation

The historical 42/1 was investigated to a root cause and **not found**.

What *was* found and removed is a genuine nondeterminism source, which is a different claim:

- `prisma.user.findFirst({ where: { pushNotifications: true } })` selected 1 of **296** candidates with no `orderBy`. Those candidates are not interchangeable: **224** resolve to `EMAIL+SMS`, **72** to `EMAIL` alone, **0** to `PUSH`. The suite was therefore asserting against a different recipient shape from run to run.
- `prisma.provider.findFirst(...)` selected 1 of **24** with no `orderBy`.

Both are now pinned with `orderBy: { id: "asc" }`.

**This does not establish that the 42/1 was caused by it.** The failing assertion was never captured, so the causal link cannot be demonstrated, and per the standing instruction it is not asserted.

**Verdict: `p6e_cert` historical anomaly — OBSERVED ONCE, NOT REPRODUCED AFTER 40 CONTROLLED RUNS.**

---

## 6. Reproducibility Results

**PASS.**

| Campaign | Runs | Result |
|---|---|---|
| Standalone `p6e_cert` | 20 | **20/20 at 43 passed / 0 failed** |
| Batch (`p6a_cert` → `p6b_cert` → `p6e_cert`, shared DB) | 20 | **20/20 at 43 passed / 0 failed** (6A 43/0 and 6B 45/0 every batch) |

Failure capture was added to both loops: any `FAIL` line would have been logged with its assertion name. None occurred. Logs: `p6e_runs_standalone.log`, `p6e_runs_batch.log`.

---

## 7. HTML Email Decision

**OUT OF SCOPE — deliberate, not deferred by oversight.**

No current contract requires it. `email.adapter.ts` sends the text body that `render()` produces, and `email.service.ts` accepts it. HTML would mean a second rendering pipeline, its own escaping rules, and its own injection surface — real work that belongs to a phase that actually needs it. It appeared only in a limitation list, and per the standing instruction, appearing in a limitation list is not a reason to implement something.

---

## 8. Backward Compatibility

**PASS.**

- **14** existing `notificationService.sendNotification` call sites outside `src/notifications/` — **zero modified**.
- The legacy service is *wrapped*, not replaced: `push.adapter.ts` calls `notificationService.sendNotification` rather than reimplementing push.
- `routeNotification` has exactly **one** caller (`automation/engine/notification-step.ts`), so the new claim semantics reach nothing legacy.
- The `RouteResult` shape is unchanged; `PENDING` is a new *value* in an existing field, and the only consumer now handles it explicitly (§11).

---

## 9. Security

**PASS.** Re-verified after the router rewrite, all five assertions green:

| Check | Result |
|---|---|
| `NotificationRequest` carries no phone/email field | PASS |
| SMS gated and off by default | PASS (`enabled=false`) |
| SMS adapter does not import the OTP service | PASS — its imports are `twilio`, `logger`, `types` only |
| Router never touches financial services | PASS |
| No `eval` / `Function` anywhere in the platform | PASS |

The claim row is written **before** the recipient is resolved, so it deliberately contains no contact detail and no message content — only identifiers.

---

## 10. Audit Hygiene

**PASS.** Verified on rows written under 4-way concurrency:

- No message body in any row.
- No recipient name, email or phone in any row.
- Every row carries an idempotency key.
- Identifiers plus outcome present.

The provisional `category`/`channel` written at claim time are corrected by `finalizeDelivery` before the row reaches a terminal status; no row ends its life describing a channel it did not use.

---

## 11. Multi-Process Verification

**PASS — and this is where the real defect surfaced.**

### The defect

`routeNotification` checked idempotency with `findUnique`, then sent, then inserted. Under concurrency **all four processes passed the lookup, all four called the adapter, and only the final insert collided.** The unique index was protecting the *table*, not the recipient. Observed directly — three of four processes died with `P2002` after doing their work:

```
pid=26044 error=P2002
pid=16772 error=P2002
pid=27168 UNAVAILABLE
pid=17776 error=P2002
```

The database showed one row. A real recipient would have received four messages. **The original 6E' assertion "exactly one delivery row exists" was measuring the wrong thing** — it could not have caught this, and did not.

Callers additionally received an unhandled Prisma exception instead of a replay.

### The fix

Claim first, send second. The row is inserted as `PENDING` before any provider is reachable, so the unique index decides the single owner *up front*; everyone else is told the operation already exists. A `updated_at` lease (120 s) lets an abandoned claim be taken over, guarded on the exact lease value read, so a worker killed mid-send cannot strand a notification forever.

The workflow step executor now treats `PENDING` as *not yet*, not as success — it throws so the job processor's existing backoff re-runs the step. Advancing there would have marked a step done for a message nobody sent.

### Evidence — 15/15, real OS processes

| Assertion | Result |
|---|---|
| M1 exactly one delivery row | PASS |
| M2 all processes name the same notification | PASS — 1 distinct id |
| **M3 exactly ONE process owned the claim and could reach a provider** | **PASS — 1 owner** |
| M4 every other process told `CLAIM_IN_FLIGHT` | PASS |
| M5 no process crashed on the unique index | PASS — none |
| M6–M8 four distinct keys → four distinct owned operations | PASS |
| M9 no distinct operation was deferred | PASS |
| M10–M12 abandoned claim taken over, identity reused, row settled | PASS |
| M13 a claim inside its lease is not stolen | PASS |
| M14–M15 audit clean under concurrency | PASS |

M3 is the assertion that carries the guarantee: ownership is counted directly, and only the owner executes the send loop.

---

## 12. Database Integrity

**PASS.**

| Check | Result |
|---|---|
| Ledger debits vs credits | 49,088,910 vs 49,088,910 — **drift 0** |
| Test rows left behind (`p6e-*`, `p6e.*`, `e2e_wf_*`) | **0** across deliveries, preferences, templates, devices, workflow instances and definitions |
| Rows stuck in `PENDING` | **0** |
| Outbox | 526 `PUBLISHED`, 7 `FAILED` |

The 7 `FAILED` outbox rows are **pre-existing and unrelated**: 1 deliberate `dlqtest.invalid.namespace` (terminal at exactly 5 attempts, as designed) and 6 `eta.*` rows at ~7,200 attempts that are documented pre-guard residue. None were produced by this work.

Migration `20260817090000_notification_delivery_claim` is **additive only** — one enum value, one column with a default. Zero destructive statements, zero data loss, applied and verified.

---

## 13. Regression Matrix

**PASS.** Every suite green after the router rewrite:

| Suite | Result |
|---|---|
| `p6a_cert` | 43 / 0 |
| `p6a_e2e` (real job processor) | 16 / 0 |
| `p6a_multiprocess` | 8 / 0 |
| `p6b_cert` | 45 / 0 |
| `p6b_freshness` | 23 / 0 |
| `p6e_cert` | 43 / 0 |
| `p6e_multiprocess` | 15 / 0 (was 8) |
| `f2_cert` | 35 / 0 |
| ETA assertions | **126 pass / 0 fail** across 55 tests |

No assertion was weakened, skipped or converted to a skip.

---

## 14. Typecheck

**PASS.**

- Backend: **131 errors — the established baseline, unchanged.** Zero errors in `src/notifications/` or `src/automation/` (explicitly filtered and confirmed).
- Admin panel: **0 errors.**

---

## 15. Build

**PASS.** Admin panel: compiled successfully, **71/71 static pages generated**, shared JS 227 kB.

*Note:* `prisma generate` reported `EPERM` renaming `query_engine-windows.dll.node` because the running dev server holds it. The generated client **types are current** — `PENDING` and `updatedAt` are both present and verified in `index.d.ts`. Only the version-identical engine binary was not replaced.

---

## 16. Cost

**₹0 incremental.** No new infrastructure, no new service, no new external dependency, no cloud resource created or touched. One additive migration on the existing local Postgres. No provider was called — no credentials are configured, and SMS is off by default.

---

## 17. NOT VERIFIED

Stated plainly, none of these are claimed as passing:

1. **Provider delivery** — no `RESEND_API_KEY`, no `EXPO_ACCESS_TOKEN`, SMS disabled. Nothing was sent to a real provider.
2. **`DELIVERED` status** — cannot be reached; no receipt mechanism exists (§3).
3. **Root cause of the 42/1 anomaly** — not identified, not reproduced.
4. **Real-device push rendering** — cannot be executed here.
5. **Production behaviour** — production was not touched and cannot be verified from here.
6. **Claim lease under real provider latency** — the 120 s lease was tested against fixtures, not against a slow live provider.

---

## 18. Known Limitations

1. **No delivery receipts.** The platform records acceptance, never confirmed receipt.
2. **HTML email absent** — deliberate (§7).
3. **PUSH reachability is low in this dataset** — 0 of 296 users have a live push target, so the PUSH path is exercised through an explicit fixture rather than organic data.
4. **The claim lease is a fixed 120 s**, not per-channel. A provider slower than that could see a second attempt. No such provider is configured.
5. **Cadence, quiet hours and cross-channel suppression are absent by design** — the 6C hook exists in `router.ts` and is empty.
6. `bun test` writes to the live `homigo_db`; all verification here used standalone scripts, never `bun test`.

---

## 19. Final 6E' Readiness for 6C

**READY — PASS WITH LIMITATIONS.**

6C needs one control point through which everything passes, and that control point now holds a guarantee that it did not hold before this remediation. Cadence and quiet-hour suppression are decisions made *before* a provider is called; the claim ordering is what makes "before" a real place in the code rather than a hopeful comment. Building 6C on the previous ordering would have meant suppression logic that four concurrent processes could each pass.

Carried forward into 6C, unchanged:

- Delivery receipts remain unbuilt. 6C must not assume `DELIVERED` is reachable.
- The 6C hook in `router.ts` is where cadence, quiet hours and cross-channel suppression belong — after recipient and category are known, before any adapter is called.
- Nothing in 6D, 6G or n8n was introduced.

**Nothing was committed, pushed or deployed. Production was not touched.**
