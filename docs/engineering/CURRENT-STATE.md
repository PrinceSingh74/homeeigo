# HOMEEIGO current engineering state

Updated: 2026-10-03 (closure loop, pass 4)

## CURRENT PHASE

Local gates, clean checkout, local staging deploy, smoke, resilience, backup, restore and rollback all executed with evidence. Cloud staging and production remain EXTERNAL. Status: **ENGINEERING CLOSED on every target that exists; NOT PRODUCTION READY (no production target).**

## CURRENT ISSUE

None. The clean-worktree confirmation run at `dd9f30a` completed: 4227 pass / 14 skip / 0 fail (4241 tests, 367 files, 1185 s) plus both inject suites. Clean checkout is PASS.

## ROOT CAUSE (closed items)

| Finding | Root cause | Fix |
|---|---|---|
| homigo_db ₹32 wallet-liability mismatch | Duplicate journals JE-00001397 (+₹168, wallet_topup for an H-Coin redemption) and JE-00001467 (−₹200, wallet_debit for a tip) | Audited reversals JE-00001559/60 after verified pg_dump; detector now ₹0.00 |
| homigo_test drift (₹300/₹4,820/₹55) | Fixtures hard-delete users/providers; wallet rows cascade, append-only journals remain | `purgeFixtureJournals()` in the canonical cleanup |
| 49 failures on a clean test DB | `test:setup` hardcoded `homigo_test` for CREATE/DROP and the financial-purge opt-out, so the guard stayed ON where suites ran | `2591052` scopes both to the DB `DATABASE_URL` names |
| Staging container crash-loop | Dockerfile never copied `analytics/`, imported by `src/lib/maintenance.ts` | `20f3389` copies it in both stages |
| `/ready` 401 | No such route — readiness is `/readyz` | deploy script probes `/readyz` |
| Register status inconsistency | Direct branch left 200, OTP branch 201 | `bca11ed` — 201 on both |

## CHANGES (10 commits, 78757da..dd9f30a)

`ec20c7c` source consolidation + reverse-journal + fixture purge + staging deploy script · `c6dcb5e` docs/evidence · `2591052` test:setup DB scoping · `bca11ed` register 201 + guard `.env.example` fallback · `a16637e` object-storage key prefix from DATABASE_URL · `91ed1c9` deploy script ASCII · `20f3389` Dockerfile analytics · `081d7a0` state doc · `dd9f30a` CI backend lint blocking.

## TESTS / RESULTS

| Gate | LOCAL | CLEAN CHECKOUT | STAGING | PRODUCTION |
|---|---|---|---|---|
| Ledger integrity (homigo_db) | PASS (₹0.00) | n/a | n/a | EXTERNAL |
| Lint ×4 | PASS | PASS (`bunx eslint`) | n/a | n/a |
| Typecheck ×6 | PASS | PASS | n/a | n/a |
| Backend suite | PASS 4227/14 skip | **PASS 4227/14 skip/0 fail** (1185 s) | n/a | n/a |
| Inject suites ×2 | PASS 6+7 | PASS 6+7 | n/a | n/a |
| Concurrency 10/50/100 cold+warm | PASS | — | n/a | n/a |
| Prod builds + bundle guard | PASS (183.9/183.2/221.7 kB) | — | n/a | n/a |
| Artifact secret scan | PASS | — | n/a | n/a |
| Migrations | 148 | 148 | 148 applied | EXTERNAL |
| Deploy | n/a | n/a | PASS (`homigo/backend:20f3389`, :3010) | EXTERNAL |
| Smoke | n/a | n/a | PASS 78/80 checks (2 need dev-only `devOtp`) | EXTERNAL |
| Resilience | n/a | n/a | PASS (redis stop/start, postgres stop→readyz 503→200, restart) | EXTERNAL |
| Backup | n/a | n/a | PASS (1.96 MB, 2072 TOC entries) | EXTERNAL |
| Restore | n/a | n/a | PASS (1007/1/23/1002/2 identical, app started, 61 checks) | EXTERNAL |
| Rollback | n/a | n/a | PASS (N→broken N+1 refused→rollback N, labels + 30 checks) | EXTERNAL |
| Release gate | refuses (correct) | — | n/a | EXTERNAL |

## OPEN ISSUES

1. Readiness does not reflect Redis loss: with `homigo-staging-redis` stopped, `/readyz` stayed 200. Postgres loss correctly produced 503. Decide whether Redis is a readiness dependency.
2. `deploy/local-staging/backend.env` reuses dev `ENCRYPTION_KEY` / `MASTER_ENCRYPTION_KEY` / `HASH_HMAC_KEY` so existing staging ciphertext stays readable — key separation is not achieved for staging.
3. `smoke-account-lifecycle` cannot complete against a `NODE_ENV=production` host (needs `devOtp`). Needs a real OTP provider or a staging-only test hook.
4. Coverage is reported, not threshold-gated (CI note, ex-P2-12).
5. `assignment_inline_dispatch_failed` logged during refund tests (assignment-engine.service.ts record-not-found) — test passes; robustness candidate.

## BLOCKERS / EXTERNAL

GCP project `homigo-497619`: `billingEnabled=False`, both Cloud SQL instances `SUSPENDED`, no Cloud Run service → **cloud staging and production are EXTERNAL**. Also external: production API URL + DNS/TLS, mobile keystores, Razorpay browser payment + live keys, managed Redis, S3/IAM, Sentry, Twilio, Resend, Maps billing.

## GIT STATE

`cursor/stage-e-step-13-certification` @ `dd9f30a`. Tree clean except `?? homigo-partner-mobile/android/app/debug.keystore` (deliberately untracked). Clean worktree `D:\homigo-clean` @ same HEAD. `backups/` 474 MB, gitignored.

## BUILD STATE

Backend image `homigo/backend:20f3389` (and `a16637e` retained as the rollback counter-example). Frontend production builds in `.next-prod` per app.

## STAGING STATE

`homigo-staging-backend` on `:3010`, image `20f3389`, labels `homeeigo.release/action`. Data plane: staging postgres (5434) + redis (6380) + pgbouncer, 148 migrations, provisioned with 23 services, demo admin/partner/customers.

## PRODUCTION STATE

Does not exist. NOT RUN, classified EXTERNAL. No production mutation was attempted.

## NEXT EXACT ACTION

Local, clean-checkout and staging closure is complete. Remaining local items are O-1 (Redis readiness contract), O-2 (staging key separation), O-4 (coverage floor), O-5 (assignment log hygiene) � see the final report. Everything else requires the external gates above (billing, production target, DNS/TLS, keystores, live payment credentials).
