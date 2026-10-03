# HOMEEIGO current engineering state

Updated: 2026-10-03 (closure loop, pass 2)

## CURRENT PHASE

Phase 1 (LEDGER) closed with evidence. Phases 2-5 re-measured earlier in this loop (see RESULTS). Next: fresh production builds + artifact scan, then git classification and the logically complete commit. ENGINEERING OPEN.

## CURRENT ISSUE

None open in the ledger. Commit and clean checkout are not done. Staging exists only as a local Docker data plane (no deployed backend yet).

## ROOT CAUSE

homigo_db (persistent dev/"production-shaped" database): WALLET_LIABILITY_MISMATCH of ₹32 was two duplicate journals: JE-00001397 (`wallet_topup:` journal posted for an H-Coin redemption that already had `hcoin_redeemed:`; +₹168) and JE-00001467 (`wallet_debit:` journal posted for a tip that already had `booking_tip:`; −₹200). Both code paths were already fixed in earlier sessions; the history still carried the duplicates.

homigo_test: drift (₹300 / ₹4,820 / ₹55 per full run, 173 orphan wallet journals) is fixture residue. Suites hard-delete fixture users and providers (allowed only on the test database); wallet rows cascade away, their journals stay. Production account deletion is a soft delete and the financial_history_delete_guard refuses ledger deletes outside the test database, so the invariant holds in production. The detector was right.

## CHANGES

- `apps/backend/scripts/reverse-journal.ts` (new): targeted mirror-image ADJUSTMENT reversal of one journal, dry-run by default, reason ≥ 20 chars, idempotency `reversal:<journalId>`, refuses to reverse a reversal.
- homigo_db: backup `backups/homigo_db-pre-ledger-reversal-20261003-144932.dump` (72,729,940 bytes, 2083 TOC entries) taken first; reversals JE-00001559 and JE-00001560 posted. No clearing journal, no history edits, no deletions.
- `apps/backend/src/__tests__/helpers/adversarial-fixtures.ts`: `purgeFixtureJournals(userIds)` removes the fixture's own journals (by `reference_id`: wallet txns, bookings, payments, H-Coin txns, gift cards, withdrawals, incentive payouts, referral rewards) before the referenced rows are deleted; called from `cleanupAdversarialFixtures`. Exported for suites with bespoke cleanups; `booking-payment-integrity.integration.test.ts` now calls it for its own customers.
- `deploy/local-staging/deploy-backend.ps1` + `backend.env.example` (new): build/migrate/deploy/rollback/status for a real backend image on the local staging data plane; `.gitignore` excludes the generated `backend.env`.

## TESTS

- `bun --env-file=.env run scripts/diagnose-wallet-liability.ts` on homigo_db: all three invariant deltas ₹0.00 (was ₹32). Re-run idempotent.
- homigo_test rebuilt with `test:setup -- --reset`, then 10 money-heavy suites (financial-ledger, booking-tip-ledger, money-matrix, p0-financial-races, gift-card-void-refund, admin-partial-refund, booking-payment-integrity, enterprise-complete, incentive-batch-evaluation, earnings-live-aggregation): 122 pass / 0 fail. CUSTOMER_WALLET ledger drift 0.00 after the run (was ₹2,500 before the fixture fix on the same subset). Residue: PROVIDER_PAYABLE ₹647 and HCOIN ₹2 from 14 provider-side journals left by suites that delete providers directly (not through the helper). Test-database only.
- `release-blocker-elimination.test.ts` in isolation: 10 pass, 250 concurrent creates 8.6 s, 500 creates 18.9 s. Run-1 timeout at 60 s was CPU contention from six parallel tsc processes, not a product regression. No timeout raised.
- `data-archival-failure-injection.inject.ts` 6 pass; `event-bus.inject.ts` 7 pass.
- 14 ledger-related suites (`financialIntegrity|HCOIN_LIABILITY|PROVIDER_PAYABLE` references): 201 pass / 0 fail.
- Backend `tsc --noEmit` after the helper edit: exit 0.

## RESULTS

Lint, four app trees, eslint src --max-warnings 0: PASS (re-measured this loop).
Typecheck exit 0: backend, customer web, admin, partner web, customer mobile, partner mobile (re-measured this loop).
Backend full `bun test --max-concurrency 1` run 1 this loop: 4226 pass, 14 skip, 1 fail (the contention timeout above, cleared in isolation).
Concurrency 10/50/100 same-provider: exactly one winner (previous pass; repeat cold/warm pending in Phase 5).
Fresh production builds, bundle guard, artifact scan: previous pass; to be re-run on the committed tree.

## LEDGER

homigo_db: PASS (₹0 drift, root-caused, audited reversals, backup on disk).
homigo_test: fixture residue reduced and explained; not a product invariant failure. Detector unchanged.

## DATA SAFETY

Test runs this loop used `cmd /c "set NODE_ENV=test&& ..."`; `.env.test` targets `localhost:5433/homigo_test`. homigo_db was written exactly once (two reversal journals) after a verified pg_dump. No production database exists.

## GIT

Branch cursor/stage-e-step-13-certification, HEAD 78757da. Not committed. Scratch moved to %TEMP%\homigo-closure\scratch (retry-*.ps1, run-bun140-suites.ps1, .drift.sql, .migval-*). Dirty tree still to be classified; do not `git add .`.

## STAGING

Local Docker data plane only (postgres 5434, redis 6380, 37 pending migrations). Backend image not yet built/deployed. Cloud staging: EXTERNAL (GCP project billing disabled, Cloud SQL SUSPENDED).

## PRODUCTION

NOT RUN. No production target exists (EXTERNAL).

## EXTERNAL

Production API URL, keystores, managed Postgres PITR, managed Redis, S3/IAM, DNS/TLS, Sentry, Razorpay browser payment, Twilio, Resend, Maps, GCP billing.

## NEXT EXACT ACTION

Phase 6/7: `NEXT_DIST_DIR=.next-prod` production builds for web/partner/admin + bundle guard + artifact secret scan. Then Phase 8-10: classify the dirty tree, commit source set and docs separately. Then clean worktree.
