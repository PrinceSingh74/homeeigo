# Concurrency Certification Report (BLOCKER 2)

**Date:** 2026-06-10 · **Outcome:** full test suite **480 pass / 0 fail**, including every wallet/gift-card adversarial concurrency test. No production data modified; live integrity 100/100.

## Three execution-proven root causes (not guessed)
Reproduced each by running the failing tests against the isolated `homigo_test` DB and reading the real Postgres error:

1. **Missing DB sequence (test env).** `nextEntryNumberWithClient` does `nextval('journal_entry_number_seq')`. That sequence is created by a *migration* (`20260609300000`), but the test DB was built with `prisma db push`, which does **not** generate custom sequences → every journal write failed with `42P01 relation "journal_entry_number_seq" does not exist`. (Live DB had it — which is why the live failure looked like a deadlock, not a missing relation.)
2. **Razorpay signature in test env.** `verifyPaymentSignature` only bypasses when `RAZORPAY_KEY_SECRET` is unset; `.env.test` inherited the real test-mode secret, so the tests' literal `"sig"` was HMAC-rejected → `INVALID_SIGNATURE`.
3. **Real wallet-settle race (live DB).** Concurrent `reconcileTopUpFromWebhook` + `verifyTopUp` on the same top-up both run `settleTopUpTransaction`, which had **no retry and no serialization** → Postgres `P2034` write-conflict/deadlock under contention.

## Fixes (minimal, idempotent, safe)
| # | Fix | File |
|---|---|---|
| 1 | `test:setup` applies custom migration SQL (sequences) after `db push` | `scripts/setup-test-db.ts` (+ `npm run test:setup`) |
| 2 | `.env.test`: empty `RAZORPAY_KEY_ID/SECRET` → dev-mock order + signature bypass | `.env.test` |
| 3a | `withTxRetry()` — retry transient `P2034/P2028/P2010` with jittered backoff | `src/lib/db-retry.ts` |
| 3b | **`pg_advisory_xact_lock(hashtext('wallet_settle:'+txnId))`** at the top of `settleTopUpInTransaction` — acquired BEFORE any row lock, so concurrent settles serialize with **zero deadlock**; the loser then reads `status=COMPLETED` and returns `alreadySettled` | `src/services/wallet.service.ts` |

The advisory lock is the decisive fix: it makes a double-settle race impossible to deadlock and impossible to double-credit (idempotent by construction). Retry is the safety net for any residual ledger-account contention.

## Evidence
- **A1 "concurrent wallet webhook + client verify does not double-credit"** → PASS **3/3** consecutive runs (was 0/3).
- **All 3 adversarial/blocker files**: 34 pass / 0 fail.
- **Full suite**: **480 pass / 0 fail** (`Ran 480 tests across 40 files`).
- **No double-credit**: the A1 test asserts `completed === 1`, `walletBalance === 1000`, single ledger entry — all green.
- **Production `tsc --noEmit`**: 0 errors. **Live `homigo_db`**: integrity **100/100 PASS**, users 197 (unchanged — test isolation held).

## Rollback
`git checkout -- src/services/wallet.service.ts && rm src/lib/db-retry.ts scripts/setup-test-db.ts` (revert the retry+advisory-lock; the test-env + sequence setup are additive).

## Concurrency stages note
The adversarial suite drives concurrent webhook+verify + concurrent gift-card redemption + concurrent order creation (the realistic financial races). True 50/100/250/500/1000-request load against running HTTP is **BLOCKER (scale)** — it needs a multi-user seed + non-laptop target; the *correctness* under concurrency (no double-credit / no double-debit / atomic ledger) is certified here by the adversarial tests.

**Verdict: BLOCKER 2 = PASS** — 0 financial race conditions in the certified scenarios, proven by green adversarial tests + advisory-lock serialization + retry, with live data untouched.
