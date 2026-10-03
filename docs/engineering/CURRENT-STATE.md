# HOMEEIGO current engineering state

Updated: 2026-10-03 (closure loop, pass 3)

## CURRENT PHASE

Phases 1-8 and 5-7 closed with evidence. Git at `20f3389` (5 commits on `cursor/stage-e-step-13-certification`). Clean worktree `D:\homigo-clean` @ same HEAD. Local staging backend container running on `:3010`. Full 31-section report and certification matrix still in progress.

## CURRENT ISSUE

Staging `/ready` returns **401** (process up, `/health` 200). Likely staging-safety / payment-env / maintenance authorization — inspect response body before calling LIVE. Clean-checkout full backend suite: **4226 pass / 1 fail** on `homigo_clean_test` before object-storage + portability fixes; **0 fail** on targeted re-runs after `a16637e`. A full clean-tree re-run after `20f3389` not repeated (43 min).

## ROOT CAUSE (ledger — closed)

homigo_db ₹32: duplicate journals JE-00001397 (+₹168) and JE-00001467 (−₹200). Reversed JE-00001559/JE-00001560 after pg_dump backup. homigo_test drift: fixture hard-deletes left orphan journals; `purgeFixtureJournals` in adversarial cleanup + `test:setup` now applies financial-purge opt-out to the database `DATABASE_URL` names (not hardcoded `homigo_test`).

## CHANGES (this loop)

| Commit | Summary |
|--------|---------|
| `ec20c7c` | Source: reverse-journal, fixture journal purge, local staging deploy script, consolidated app/mobile/deploy |
| `c6dcb5e` | Docs/evidence + `CURRENT-STATE.md` |
| `2591052` | `test:setup` DATABASE_URL-scoped DB create/drop + purge opt-out |
| `bca11ed` | Register 201 both paths; guard tests use `.env.example` when `.env` absent |
| `a16637e` | Object-storage S3 key prefix from `DATABASE_URL` db name |
| `20f3389` | Dockerfile copies `analytics/` (fixes staging boot) |
| + PS deploy script ASCII fix | |

## RESULTS

| Gate | Status | Evidence |
|------|--------|----------|
| homigo_db ledger | **PASS** | All invariant deltas ₹0.00 after reversals |
| Lint (web/partner/admin) | **PASS** | `--max-warnings 0` / `next lint` |
| Lint (backend clean tree) | **BLOCKED** | Use `bunx eslint` from `apps/backend` (PATH) |
| Typecheck ×6 (clean @ HEAD) | **PASS** | After `prisma generate` + `.env.test` |
| Concurrency 10/50/100 broadcast | **PASS** | cold+warm, exactly one winner |
| Same-partner accept 50/100 | **PASS** | wave2 suite cold+warm |
| Production builds `.next-prod` | **PASS** | web/partner/admin |
| Bundle guard | **PASS** | 183.9 / 183.2 / 221.7 kB shared (budgets unchanged) |
| Artifact secret scan | **PASS** | No private keys/sk_live/AKIA; Maps keys are `NEXT_PUBLIC_*` only |
| `release-env` | **EXPECTED FAIL** | No production API/site URL (EXTERNAL gate) |
| Backend suite (main homigo_test) | **PASS** | 4226+ after isolation fixes; inject 6+7 |
| Backend suite (clean homigo_clean_test) | **INCONCLUSIVE** | 4226/1 before last fixes; inject PASS |
| Security spot (payment-env, staging-safety, refresh cookies) | **PASS** | 34 tests + loopback ×3 |
| Local staging Docker | **PARTIAL** | Image `homigo/backend:20f3389`, migrate +37 applied, health 200, ready 401 |
| GCP Cloud staging/prod | **EXTERNAL** | Billing disabled, Cloud SQL SUSPENDED |

## GIT

Branch `cursor/stage-e-step-13-certification`, HEAD `20f3389`. Working tree clean except `?? homigo-partner-mobile/android/app/debug.keystore` (intentionally untracked).

## STAGING

Data plane: `homigo-staging-postgres` / `-redis` (healthy). Backend: `homigo-staging-backend` on host `:3010`. Migrations: 148 applied. `deploy/local-staging/backend.env` present (gitignored).

## PRODUCTION

NOT RUN. No deploy target.

## NEXT EXACT ACTION

1. Read `/ready` body on `:3010`; fix staging env until ready 200 or document authorized degradation.  
2. Re-run full backend suite on `D:\homigo-clean` @ `20f3389` (or CI) for reproducible PASS.  
3. Staging smoke scripts with `API_URL=http://127.0.0.1:3010`; backup/restore/rollback on local staging.  
4. Publish final certification matrix + 31-section report.
