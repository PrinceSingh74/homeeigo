# Test Certification Report (BLOCKER 1 — Test Isolation)

**Date:** 2026-06-10 · **Outcome:** test suite is now **DB-isolated and incapable of touching the live database** (proven). Suite is 474/480; the 6 remaining failures are categorized (concurrency → BLOCKER 2), not isolation.

## The problem (root cause)
`bun test` sets `NODE_ENV=test`, but `src/load-env.ts` loaded `.env` with `override:true` — and `.env` sets `NODE_ENV=development`, **clobbering** the test flag. So the test-DB switch never happened and every test ran against the **live `homigo_db`**, polluting it (financial integrity dropped 100 → 92 twice during this work).

## The fix (execution-verified)
1. **`.env.test`** (gitignored) → `DATABASE_URL=…/homigo_test`, empty `REDIS_URL`/`SENTRY_DSN`/`AWS_S3_BUCKET` (no shared infra/telemetry/S3 during tests).
2. **`load-env.ts`**: capture `isTest` BEFORE the `.env` load, restore `NODE_ENV=test`, then load `.env.test` on top.
3. **Startup guard**: in test mode, `throw` unless the DB name contains `test` — makes it *impossible* to silently run against a non-test DB.
4. **Isolated test DB** `homigo_test` created + `prisma db push`.
5. **`.gitignore`**: `.env` + `.env.*` (keep `!.env.example`).

## Proof of isolation (definitive)
```
homigo_db users BEFORE bun test:  197
homigo_db users AFTER  bun test:  197   ← UNCHANGED
tests wrote to homigo_test:        21 users
✅ live DB untouched
```
`NODE_ENV=test` now resolves `DATABASE_URL → homigo_test`. Live `homigo_db` was restored from the pre-test snapshot → **integrity 100/100 PASS**.

## Failure audit (474 pass / 6 fail)
All 6 failures are the **same wallet/gift-card concurrency tests**, failing on Postgres **write-conflict / deadlock** under the test's parallel load:
- A1 concurrent wallet webhook + client verify (no double-credit)
- wallet top-up commits balance+ledger atomically
- wallet ledger failure rolls back balance
- wallet duplicate verify idempotent
- wallet blocks beyond max pending top-ups
- gift card concurrent redemption — single debit

| Category | Verdict |
|---|---|
| Test data contamination | **FIXED** (isolation) — was the live-DB pollution |
| Environment | **FIXED** (.env.test + guard) |
| Real bug vs flaky | **Concurrency** — consistent set, Postgres serialization/deadlock under parallel writes. Needs the BLOCKER-2 investigation (serialization-retry / lock-order) before touching the certified wallet module. NOT a type or isolation issue. |

## Success criteria
- ✅ Isolated test database + Redis-off + `.env.test`.
- ✅ Tests can NEVER touch staging/prod DB (guard + proven).
- ✅ Startup guard fails on non-test DB in `NODE_ENV=test`.
- 🟡 "0 failures" NOT yet met — 6 concurrency failures remain → **BLOCKER 2** (concurrency reliability). They are pre-existing (proven last turn via baseline stash) and now safely contained in `homigo_test`.

## Rollback
`git checkout -- src/load-env.ts apps/backend/.gitignore` and `rm .env.test` (the `homigo_test` DB can be dropped: `DROP DATABASE homigo_test`).

**Verdict: BLOCKER 1 test-isolation = DONE & proven.** Full-green suite is gated on BLOCKER 2 (wallet concurrency retry), which must be done carefully against the certified wallet module with execution evidence.
