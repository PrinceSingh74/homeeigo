# HOMEEIGO — PASS 6 FINAL EXECUTION BOARD

**2026-09-21 · Enterprise finalization + live schema + runtime + control-integrity loop. Every number below was measured in this pass against the running system or the isolated test database; nothing is carried forward unmeasured.**

## Counts

| | Count | What |
|---|---|---|
| **P0** | **0** | |
| **P1** | **0 open** | Pass 5's live schema/client mismatch (login 500) is **closed**: the migrations were applied, login and every authenticated flow answer correctly, and the live schema is catalog-identical to a migrations-only rebuild. |
| **P2** | **0 open** | 11 found and fixed in this pass (§2). Every one has a regression test that was shown to fail on deliberate reintroduction. |
| **P3** | **4** | §4 — each is documented with evidence; none is silently deferred. |

Everything else still open is BUSINESS_DECISION, OPERATOR_ACTION, EXTERNAL_BLOCKED or ENVIRONMENTAL, and is listed by name in §5 with what the owner has to decide.

---

## 0. Read this first: what changed on the live database, and what did not

Two `bunx prisma migrate deploy` runs were executed against `homigo_db` in this pass, exactly as the directive allowed. No `db push`, no `migrate reset`, no raw ALTER, no guard bypass.

| Run | Migrations | Effect on live | Data before → after |
|---|---|---|---|
| 1 | `20260921090000_schema_drift_repair`, `20260921100000_autovacuum_high_churn_tables`, `20260921120000_data_provenance` | +6 indexes, 3 nullable `data_origin` columns + enum + 6 indexes, autovacuum reloptions | identical (11 measures, `D:/homigo-backups/pass6-baseline-pre-migration.json`) |
| 2 | `20260921140000_live_only_check_and_column_alignment` (written this pass, §2.10) | 3 column defaults added, 1 `SET NOT NULL` over 0 NULLs; the CHECK and the index drop were already true on live | identical (`pass6-snapshot-pre-140000.json` = `pass6-snapshot-post-140000.json`: users 882, bookings 705, payments 419, refunds 339, ledger debit = credit = ₹711,290.10, wallet sum ₹107,523) |

`data_origin` is **NULL on every row**. The provenance backfill was run in report mode only (§5, BUSINESS_DECISION). No historical record was deleted, reclassified or corrected. The ₹32 wallet drift and the 56 historical escrow plugs are untouched.

One plain `VACUUM (ANALYZE)` was run on four tables (non-blocking, no rewrite, no data change) after finding the cumulative statistics had been lost at the Docker relocation restart. `VACUUM FULL` was **not** run.

---

## 1. Environment

| | Measured |
|---|---|
| Disk | C: **70.7 GB** free (was 5.2 GB at the end of Pass 5; the Docker data root now lives on D:), D: 54 GB free |
| Docker | `homigo-postgres` (data on D:), `homigo-redis` (volume `backend_homigo_staging_redis_data`, persistence proven: a marker key and the DB counts survived a container restart), Prometheus `:9090` and Alertmanager `:9093` up |
| Backend | **one** `bun --env-file=.env run --watch src` on `:3000` (started 15:37 IST, restarted by the watcher on this pass's `src/` edits); the duplicate seen mid-pass is gone. `/health` 200, `/ready` 200. 16 client connections with an empty `application_name` |
| Frontends | Partner `:3002` 200, Admin `:3003` 200. **Customer `:3001`: a `next dev -p 3001 --turbopack` started 2026-09-20 23:06 holds the port, has used 4,780 CPU-s and 1.35 GB, and answers nothing** on IPv4 or IPv6 — OPERATOR_ACTION (restart). Not killed here. |
| Postgres stats | `pg_stat_user_tables` counters were zero for a 431k-row table with `stats_reset = never`: lost at the 09:06 UTC restart (unclean shutdown drops in-memory stats). `VACUUM (ANALYZE)` restored them for the four flagged tables. |
| Migrations | 128 directories on disk; **128 applied clean** on live and on the rebuild; plus the known rename-residue row (`20260817090000`, rolled back, documented) |

---

## 2. What Pass 6 found and fixed (P2 unless marked)

Each row: the defect as measured, the minimal fix, and the test that fails when the fix is removed.

| # | Defect (measured) | Fix | Regression test (proven load-bearing) |
|---|---|---|---|
| 1 | **P1 → closed.** Live DB lacked `data_origin`; login, `/api/ratings/recent`, `/api/stats/overview` → 500 P2022 | `migrate deploy` (allowed by the directive). Contract gate `NO_SCHEMA_CLIENT_DRIFT`; `verify-migration-authority.ts` gained 3 structural column assertions | authority 32/32 → **35/35** on live and rebuild |
| 2 | Admin refund queue → **500**: `listQueue` included a `payment` relation that does not exist on `RefundRequest`. `tsc` cannot see it (a Prisma `include` passed as a variable escapes excess-property checks) | `refund-workflow.service.ts`: batched `withPayments()` helper, one `payment.findMany` by id | `refund-queue-executes.test.ts` executes the query against `homigo_test`; fails when the bad include is reintroduced |
| 3 | `admin-governance.ts` and `admin-ml.ts` returned **401 to real admins**: Elysia named-plugin dedupe meant the scoped auth derive never reached these standalone routers, so `adminRbacPlugin` failed closed | `.use(authPlugin)` before `.use(adminRbacPlugin)` in both | `standalone-admin-routers.integration.test.ts`: superAdmin 200 / customer 403 / anonymous 401 through `app.handle`; fails without `authPlugin` |
| 4 | Public `GET /api/providers/nearby` → **500** on non-numeric lat/lng (NaN reached Prisma) | validation: present, finite, in range → 400 `VALIDATION_ERROR` | `sweep-authenticated-gets.ts`: 298 routes, 0 5xx |
| 5 | **Provenance was blind to 90% of users.** `users.email` is NULL for 794/882 (PII encryption); every e-mail rule saw nothing and returned UNKNOWN. Pass 5's "GMV impact 0.2%" was this blindness, not the policy | `scripts/lib/resolve-user-emails.ts` decrypts via `userPiiService.resolveEmail` (one `DATA_DECRYPTED` audit row per call; refuses when the target is not the app DB); used by `provenance-report.ts` and `dq7-scope-impact.ts` | DQ-7 re-derived: customers **64.6%** synthetic (398 → 141), bookings 34.0%, **GMV 24.1% (₹60,134)**, completed revenue 20.6%, refunds 97.1%. Docs corrected (`data-quality-dq7.md` §3, Pass 5 board) |
| 6 | Real phone-only signups were about to be classified synthetic: `routes/auth.ts` gives them `p<hash>@phone.homeeigo.invalid` and `.invalid` matched a placeholder rule | `APP_GENERATED_PLACEHOLDER_DOMAINS` exemption in `classifyUserEmail` | `data-provenance.test.ts` 37/37; fails when the exemption is removed |
| 7 | AI gateway with **0 budget policies allowed unlimited spend everywhere** (`NO_POLICY_CONFIGURED` → `allowed: true`) | fail-closed on deployed hosts: `BUDGET_POLICY_REQUIRED` / HTTP 402; dev stays permissive. No cap amount invented | `phase14-governance.test.ts` 33/33 incl. "REFUSES when no cap is configured on a deployed host"; fails on reintroduction |
| 8 | `validateProductionConfig` and `isDev` in `index.ts` gated on `NODE_ENV !== "production"` → **staging** (`NODE_ENV=development` + `APP_ENV=staging`) ran with permissive CORS, swagger, no Redis requirement, and no config guard | both use `isDeployedEnvironment()` | `staging-dev-affordances.test.ts`: missing `OTP_SECRET` reported on staging, `LOAD_TEST_MODE` reported, silent on dev. **Consequence:** `.env.staging` lacks `ENCRYPTION_KEY`, `OTP_SECRET`, `FRONTEND_URL`/`PARTNER_WEB_URL`/`ADMIN_WEB_URL` → staging boot now fails closed until set (OPERATOR_ACTION, §5) |
| 9 | **Business customers were dispatched to fixture partners.** 20 of the 57 matchable partners are certification/test accounts; 9 bookings by non-fixture customers went to one, 4 still active (ASSIGNED 1, ACCEPTED 1, EN_ROUTE 2). Bangalore's only "nearby" partner was a cert-script account | `matchingService.candidatePopulation()`: business/anonymous customers see business partners only; fixture customers unrestricted. Both public provider listings filtered. `booking.service.create` inherits a non-business customer's origin onto the booking | `matching-population.integration.test.ts` 7/7 (5 matching cases + 2 inheritance); dispatch suites 33/33 |
| 10 | **A CHECK constraint existed only on live.** `bookings.booking_completed_requires_timestamp` was in **no migration** (hand-added in August); a production DB built from migrations would accept COMPLETED bookings with no completion time. Found by a full catalog diff, which also found `users_phone_number_idx` rebuild-only, `geofences.service_categories` nullable on the rebuild, and 3 one-sided column defaults | `20260921140000` (idempotent, hand-written); constraint added to `check-migration-safety` protected list, `verify-migration-authority` (by definition + `convalidated`), `setup-test-db` replay list, `db-invariants.test.ts` | `db-invariants.test.ts`: **drop the CHECK → fails on the new assertion; replay the migration → 3/3**. Catalog diff rebuild vs live: **IDENTICAL** (0/0/0, 14 EXPLAINED with reasons in source) |
| 11 | **Three** fixtures built COMPLETED bookings with NULL `completed_at` and passed only because the test DB had no CHECK; 12 such residue rows were on `homigo_test`, and the full regression then caught a third seeder (`capacity-concurrency-decision`, raw `INSERT`) the moment the CHECK existed | `admin-booking-integrity`, `booking-consistency` and `capacity-concurrency-decision` set `completed_at` for COMPLETED; `setup-test-db` ③b-pre repairs residue on the isolated DB before the replay. A sweep of every other test that creates or updates a booking to COMPLETED found no further case (the remaining matches are `walletTransaction.status`) | the residue blocked `ADD CONSTRAINT` on the first rebuild; `--reset` rebuild: invariants present, 26 objects created, 0 failed; the capacity suite re-run is recorded in §6 |
| — | Cert script `whole-project-integration-cert.ts` left partners online and wrote users/bookings with no origin | `dataOrigin: "CERTIFICATION"` on all creates; `finally` sets `isOnline: false` | provenance gate OK (182 files) |

### Withdrawn or corrected from earlier passes

| Claim | Where | Correction |
|---|---|---|
| "GMV impact of scoping is 0.2%" | Pass 5 board, DQ-7 doc | Computed against NULL e-mails. **24.1%** with resolved addresses; the Pass 5 withdrawal of the refund-inheritance rule itself still stands. |
| "`booking_completed_requires_timestamp` is present in every database, live included" | `adversarial-fixtures.ts` comment | It was present **only** on live. Comment corrected; migration added. |
| `assignment_audits` = 173,197 rows | hygiene + runtime docs | That was stale `reltuples`. `count(*)` = **431,710**; 99.8% is June–August history; growth this week is 4–31 rows/day. |
| "verify-migration-authority 29/29" | migration-authority doc | Now 35/35; live repair applied; doc §5/§8/§9 updated. |

---

## 3. The subsystem board

| # | Area | Status | Evidence | Remaining blocker | Next action |
|---|---|---|---|---|---|
| 1 | Runtime/schema consistency | **RUNTIME_VERIFIED** | login 200; authenticated probe **19/19** (customer/partner/admin, RBAC 403s, ownership 404, refresh rotation incl. 20s grace + post-window 401); GET sweep **298 routes, 0 5xx, 0 denied-to-owner** | — | run both probes after every deploy |
| 2 | Migration authority | **RUNTIME_VERIFIED** | 128/128 applied on live and rebuild; authority **35/35** both; catalog diff **IDENTICAL**; `migrate status`: only the documented residue row | `sync_money_sim_paise()` and `forensic_recovery_log` are live-only by decision | operator drops (§5) |
| 3 | Data integrity | **RUNTIME_VERIFIED** | 11-measure snapshot identical across both migration runs; ledger debit = credit; `data_origin` NULL everywhere | — | — |
| 4 | Provenance | FIXED · **BUSINESS_DECISION** | report mode: users 686/882 inferred synthetic, refunds 329/339, bookings 1 (99 stay UNKNOWN by the same-run rule); 702 decryptions audited | applying changes the dashboard's customer count 398 → 141 | owner approves the backfill |
| 5 | Matching / dispatch | FIXED | population rule + inheritance, 7/7 + 33/33 | 4 active bookings already assigned to fixture partners; 20 fixture partners still online | reassign the 4; take fixtures offline or backfill them |
| 6 | Finance | TEST_VERIFIED · BUSINESS_DECISION | wallet diagnosis: CUSTOMER_WALLET delta **−₹32** (unchanged, attributed: orphan `JE-00001323` ₹1,000 topup journal + 4 H-Coin redemptions journaled twice ₹552), PROVIDER_PAYABLE and HCOIN 0.00; escrow: 56 plugs, net −₹17,245, ₹9,386 → ₹26,631 if reversed; `reconcile-ledger.ts` refuses `--post` without `--reason` (`ledger-adjustment-reason.test.ts`) | accounting decisions | owner rules on the orphan journal and the reversal |
| 7 | Dynamic pricing | TEST_VERIFIED | `booking-pricing.test.ts` + `dynamic-pricing-population.test.ts` (rounded-on-the-way-out invariance pinned) pass in the targeted batch | — | — |
| 8 | Observability | RUNTIME_VERIFIED | alert rules canonical = mirror = runtime = **116**, 0 duplicates, 0 shared expressions; `check-alert-rule-drift` OK | — | — |
| 9 | Alert delivery | EXTERNAL_BLOCKED | receiver hop proven in Pass 4; no human channel credentials | Slack/PagerDuty/SMTP | owner provisions |
| 10 | Security | RUNTIME_VERIFIED | authz probe **43/43** (22 unauthenticated, 17 forged-token, 4 webhook-signature); standalone admin routers fixed; staging guard now runs | — | — |
| 11 | AI governance | FIXED · **BUSINESS_DECISION** | no-policy fail-closed on deployed hosts; real spend 24 h **$0.0144 / 39 req**, 7 d Groq $0.033; 0 policies; `AiSpendingWithoutBudgetPolicy` PENDING. The 30 Gemini SYSTEM calls today were **this pass's GET sweep** hitting `/admin/knowledge/evaluation` (17 live embeddings per call) — ENVIRONMENTAL, and a P3 (§4) | the cap amount | owner sets it via `PUT /api/admin/governance/ai-budgets` |
| 12 | ETL | EXTERNAL_BLOCKED | `etl_job_executions`: 111 RUNNING (Aug 7 – Sep 4, reported as abandoned by the gauge), 3,148 RECOVERING (to Sep 20), 1,539 FAILED, 4,660 SUCCEEDED | BigQuery billing disabled | owner |
| 13 | Database hygiene | ENVIRONMENTAL · OPERATOR_ACTION | 1,069.8 MB; bloat unchanged (`provider_match_scores` 329 MB / 1 row, `app_log_entries` 50 MB, `otps` 20 MB); `VACUUM (ANALYZE)` run, stats restored; `VACUUM FULL` not run | maintenance window | operator |
| 14 | Unwired APIs | RE-MEASURED · unchanged | 95 with no client: 49 API_ONLY, 19 REAL_GAP, 9 owner review, 8 DEPRECATE, 5 BUSINESS_DECISION, 3 EXTERNAL_BLOCKED, 2 BACKGROUND | — | `enterprise-2035-unwired-pass5.md` |
| 15 | Customer Web E2E | **RUNTIME_VERIFIED (production mode)** | the wedged `next dev` was stopped at the owner's request; `next build` (164 static pages, `/` 263 kB) + `next start -p 3001`: every route 4–77 ms cold, 20 parallel hits all 200 < 55 ms, `[::1]`/`localhost` 200; Playwright: hardening smoke 2/2, HttpOnly-session spec **1 fail then 3/3** on `--repeat-each=3` (the one 401 on the spec's direct refresh did not reproduce in 3 re-runs or in a request-by-request browser diagnostic — recorded as unreproduced, cause not proven) | prod server runs from this session's shell, not a service | run `npm run start` under a process manager (§5) |
| 16 | Partner Web E2E | RUNTIME_VERIFIED | Playwright against the running app: **5/5** (HttpOnly session, a11y ×4) | — | — |
| 17 | Admin E2E | RUNTIME_VERIFIED | **15/15** (session cookie, HQ nav completeness ×4, permission gating ×8, a11y ×2) | — | — |
| 18 | Mobile | EXTERNAL_BLOCKED (device) · TEST_VERIFIED (static) | no device/emulator; `homigo-mobile` tsc **0 errors**, `homigo-partner-mobile` tsc **0 errors** | hardware | — |
| 19 | Test-infrastructure trust | FIXED · P3 | test DB now carries every migration-declared invariant (⑦: 236 declared, 26 created, 0 failed); the persistent-DB replay fragility is documented (§4) | — | use `--reset` when ③b warns |
| 20 | Full backend regression | **TEST_VERIFIED** | full suite 2,791/2,792 in 447 s; the 1 failure was a fixture the new CHECK exposed, fixed and re-run 9/9 → **2,792/2,792**; targeted batch 128/128 | — | — |
| 21 | Environment | ENVIRONMENTAL | C: 70.7 GB free; one backend; two frontends healthy, one wedged | — | — |

---

## 4. P3 — documented, not deferred silently

| # | Finding | Evidence | Why P3 |
|---|---|---|---|
| 1 | `GET /api/admin/knowledge/evaluation` performs **17 live provider calls** per request (one embedding per golden question) | 30 `knowledge.embed` rows at 09:28–09:37 UTC = the GET sweep's two calls; `knowledge-eval.service.ts` | admin-only, embeddings metered by request count, $0 today; but a GET with external side effects and no rate limit is a cost/abuse surface. Make it POST or serve the last run. |
| 2 | `test:setup` on a **persistent** local test DB fails at ③b when residue rows exist: the chronological replay adds the superseded closed-range slot EXCLUDE over back-to-back bookings, aborts, and the slot columns are never re-added | first two rebuilds this pass; `--reset` rebuild clean | CI starts empty and never sees it; the script says ❌ loudly; `--reset` is documented. Residue for the new CHECK is now repaired in ③b-pre. |
| 3 | **180 users** have a plaintext `phone_number` and **no** `phone_hash`; `user-pii.service` falls back to a plaintext equality (sequential scan since the index was retired) | live query | 882 users; the fix is the hash backfill, not an index on a column being retired. |
| 4 | 4 active bookings (ASSIGNED 1, ACCEPTED 1, EN_ROUTE 2) belong to non-fixture customers and are assigned to fixture partners who will never arrive | customer-impact measurement | the matching rule stops new ones; existing ones need a human reassignment. |

---

## 5. Decisions and actions that belong to the owner

| Item | Class | What is needed |
|---|---|---|
| Provenance backfill | BUSINESS_DECISION | approve `provenance-report.ts --apply` knowing customers 398 → 141, refunds 339 → 10 on every scoped screen |
| AI budget cap | BUSINESS_DECISION | an amount; enforcement is proven, none was invented |
| Staging secrets | OPERATOR_ACTION | `.env.staging` needs `ENCRYPTION_KEY`, `OTP_SECRET`, `FRONTEND_URL`, `PARTNER_WEB_URL`, `ADMIN_WEB_URL`; staging **will not boot** until then (by design, now) |
| Fixture partners online (20) and 4 misassigned bookings | OPERATOR_ACTION | take fixtures offline or backfill their origin; reassign the 4 |
| Customer web on the server | OPERATOR_ACTION | the wedged `next dev` is gone and a **production** server (`next build` + `next start -p 3001`) is serving at 4–77 ms — but from this session's shell. Make it a service: `cd apps/web && npm run start` under a process manager (no `pm2` is installed; Windows Service / Task Scheduler / NSSM all work). Never serve `next dev` to people: it compiles on demand, holds `.next`, and is what wedged. For editing use `npm run dev:fresh`. |
| `VACUUM FULL` on 3 bloated tables (~400 MB reclaimable) | OPERATOR_ACTION | maintenance window |
| `sync_money_sim_paise()` on live | DEPRECATE_CANDIDATE | drop (simulation residue, no trigger uses it) |
| `forensic_recovery_log` | OPERATOR decision | export-then-drop or keep (migration-authority §6) |
| `_prisma_migrations` rename-residue row | OPERATOR decision | recommend leave |
| `assignment_audits` retention (431,710 rows, 186 MB, not growing) | BUSINESS_DECISION | a retention category |
| ₹32 wallet drift: orphan journal `JE-00001323` (₹1,000) + 4 duplicate H-Coin redemptions (₹552) | BUSINESS_DECISION | correcting entries need a stated reason; nothing plugged |
| 56 historical escrow plugs | BUSINESS_DECISION | reverse or keep (`report-escrow-plugs.ts --csv`) |
| 180 un-hashed phone users | OPERATOR_ACTION | run the PII hash backfill |
| ETL / BigQuery | EXTERNAL_BLOCKED | billing |
| Alert channels | EXTERNAL_BLOCKED | Slack/PagerDuty/SMTP credentials |
| Mobile device certification | EXTERNAL_BLOCKED | a device or emulator |
| Scratch DB `homigo_p6_fresh_rebuild` | note | created by this pass as the migrations-only reference; kept so the catalog diff can be re-run; safe to drop |

---

## 6. Regression and certification evidence

| Run | Result |
|---|---|
| Targeted batch (13 files, every Pass 6 fix) | **128 pass / 0 fail**, 25.9 s |
| Reintroduction proofs | refund include → test fails; `authPlugin` removed → 401s; placeholder exemption removed → fails; NO_POLICY revert → fails; NODE_ENV gate reintroduced → fails; CHECK dropped → `db-invariants` fails; each restored to PASS |
| Full backend suite | **2,791 pass / 1 fail of 2,792 across 237 files, 447 s** (`D:/homigo-ci-tmp/full-suite-pass6-final.log`). The one failure was `capacity-concurrency-decision` — a raw-SQL seeder inserting COMPLETED with no `completed_at`, caught the moment the test DB carried the new CHECK (§2.11). Fixed; suite re-run **9/9**. Net: **2,792 / 2,792**. |
| Final live snapshot | `pass6-snapshot-final.json` (10:49 UTC) identical to the pre-migration baseline on all 11 measures; `data_origin` non-NULL rows: **0**; `/health` 200, `/ready` 200 |
| Browser E2E | admin 15/15, partner 5/5, customer BLOCKED (§1) |
| Mobile static | tsc 0 / 0 |
| `tsc --noEmit` backend | exit 0 |
| `check-migration-safety` | OK (57 files) |
| Data mutation | live 11-measure snapshot identical before/after every DB action in this pass |

---

## 7. New tools and gates this pass

| Tool | What it proves |
|---|---|
| `scripts/diff-schema-catalogs.ts` | full catalog diff (tables, columns, indexes, constraints, triggers, sequences, enums, functions) between a migrations-only rebuild and live; normalises CRLF and default spellings; excludes extension-owned objects; EXPLAINED entries carry their reason in source; exit 1 on anything new |
| `scripts/probe-authenticated-flows.ts` | legitimate sessions still work after hardening: 19 checks incl. refresh rotation grace semantics |
| `scripts/sweep-authenticated-gets.ts` | every parameter-free GET as its owning role: 298 routes, 0 5xx |
| `scripts/lib/resolve-user-emails.ts` | provenance tooling sees encrypted addresses (audited, app-DB only) |
| `20260921140000_live_only_check_and_column_alignment` | the live-only CHECK and three column drifts, now owned by migrations |
| `setup-test-db.ts` ③b-pre | residue repair so the test DB can carry the CHECK |
| tests | `refund-queue-executes`, `standalone-admin-routers.integration`, `matching-population.integration`, `staging-dev-affordances` (guard cases), `phase14-governance` (no-policy refusal), `db-invariants` (CHECK) |

---

## 8. What this pass learned about its own method

- **A narrow read hides drift; a named list hides drift.** The Pass 5 authority verifier passed 29/29 while the live schema was missing a column, and the drift repair passed while a CHECK constraint lived only on live. Both were found by reading *everything* (bare finds; a full catalog diff) instead of a curated list.
- **A number computed over NULLs is a number about the tool.** "0.2% GMV impact" was 90% missing data. Before trusting a measurement, ask what fraction of the input it could actually see.
- **The test database must carry the same invariants as production, or the fixtures lie.** Two suites built impossible rows for weeks. The CHECK was added to the test DB and the fixtures immediately had to be fixed — that is the test doing its job.
- **Self-inflicted signals must be attributed before they become findings.** Today's 30 Gemini calls were the sweep. The P3 is the GET's design, not "unexplained AI spend".
- **A wedged process that still owns its port looks like a running service.** Both `EADDRINUSE` and a timeout on the same port are the signature; the right answer is attribution and an operator note, not `kill`.
