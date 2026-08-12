# Financial Runtime Hardening Report (Phase 1)

**Date:** 2026-06-10 · **Scope:** the two named financial-runtime findings only. No production data modified.

## Phase 0 — data protection (before any change)
- Full backup: 137 MB dump, `pg_restore --list` ✅, sha256 `b2bf8f8b…d3ae7`, on S3 (eu-north-1, SSE AES256).
- Integrity baseline: `p2:wallet-integrity` = **100/100 PASS**.
- Liability baseline: wallet **₹9,389** · provider payable **₹12,480** · ledger entries **204** · payments **8**.

## Finding 1 — `wallet.service.ts:196` (Prisma type-only import used as value)
- **Reproduced:** `tsc` → `TS1361: 'Prisma' cannot be used as a value because it was imported using 'import type'`. At runtime `Prisma` would be `undefined`, so the `error instanceof Prisma.PrismaClientKnownRequestError` guard in the idempotent-topup race handler would **throw**, defeating the P2002 dedupe on concurrent wallet top-ups.
- **Fix:** `import { …, type Prisma }` → `import { …, Prisma }` (value import). One line; no logic change.
- **Risk:** none — restores the intended runtime guard.

## Finding 2 — `payment.service.ts:269–271` (missing EXPIRED/FAILED guard)
- **Reproduced:** `tsc` → `TS2339` on `walletTransactionId` / `status` / `balance`. Root cause: `verifyTopUp` can return `{error:"EXPIRED"}` / `{error:"FAILED"}`, but the reconcile path only handled `NOT_FOUND` + `INVALID_SIGNATURE` before reading success fields → a **phantom success response** (undefined txn id / balance) for an expired or failed top-up.
- **Fix:** added explicit `EXPIRED` and `FAILED` guards that return the real error (service), and handled both in the verify route → HTTP 400 with a clear message. Success fields are now type-safe (union narrowed).
- **Risk:** none — turns a silent phantom-success into a correct error; no balance/ledger path changed.

## Regression evidence (after fix)
| Check | Result |
|---|---|
| `tsc` on the two targets | **resolved** (no wallet:196 / payment:269-271 errors) |
| Financial integrity | **100/100 PASS** (unchanged) |
| Liabilities | wallet ₹9,389 · provider ₹12,480 · ledger 204 · payments 8 — **IDENTICAL to baseline ⇒ 0 data modification** |
| Backend boot | HTTP 200 |
| `smoke:part3` (payment/wallet/booking) | **67 passed / 0 failed** |

## Rollback
`git checkout -- src/services/wallet.service.ts src/services/payment.service.ts src/routes/payments.ts` (all changes are in the working tree, uncommitted).

## Out of scope — NOT touched (flagged honestly)
`tsc` now also reports errors in `address.service.ts:84-85`, `booking-live.service.ts:109`, `gift-card.service.ts:348`. These appeared after recent edits to those files (they were NOT present a few runs ago, and are NOT in this Phase-1 scope). They look like an in-progress refactor (e.g. `AuditContext` type change, address PII encryption). Per the rules ("do not refactor working modules / do not modify without evidence"), they were **left untouched**. They do not block runtime (Bun ignores TS at run time), but should be resolved to reach a clean `tsc`. Recommend fixing them deliberately (with the same reproduce→fix→regression rigor) once the in-progress edits settle.

**Verdict: Phase 1 PASS** — both named financial-runtime risks eliminated, 0 regressions, 0 data modification.
