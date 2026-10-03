# HOMEEIGO — PASS 5 FINAL EXECUTION BOARD

**2026-09-21 · Every number below was measured in this pass. Nothing is carried over from an earlier pass without being re-measured.**

## Counts

| | Count | What |
|---|---|---|
| **P0** | **0** | |
| **P1** | **1** | MIG-6. The schema/client mismatch is now **live**: login returns 500. Blocked on one operator command. |
| **P2** | **0 open** | 12 found and fixed in this pass, listed in §2. |
| **P3** | **4** | All four need an owner decision. |

Anything else still open is BUSINESS_DECISION, OPERATOR_ACTION, EXTERNAL_BLOCKED or ENVIRONMENTAL.

---

## 0. Read this first: the P1 is now live

Pass 4 said the backend looked healthy only because it held an older generated client, and that a restart would break it. **That restart has now happened, and the break is real.**

The dev backend runs under `bun run --watch src`, which restarts the process whenever a file under `src/` changes. **My source edits in this pass triggered that restart.** The process came back up on the regenerated Prisma client, and the migration that adds `data_origin` still has not been applied to `homigo_db`:

```
POST /api/auth/login      -> 500  P2022  prisma.user.findFirst() in user-pii.service.ts
GET  /api/ratings/recent  -> 500  (customer home-page reviews)
GET  /api/stats/overview  -> 500  (public counters)
GET  /api/services        -> 200   GET /api/services/featured -> 200
```

**Login on the local environment is broken until the migration is applied.** I did not route around it. Removing the column from the app, running raw `ALTER`, or bypassing the deploy refusal are all explicitly ruled out, and each would leave schema, migrations, client and database disagreeing somewhere else.

```bash
cd apps/backend
bunx prisma migrate deploy
bun run scripts/check-schema-client-contract.ts --url "$DATABASE_URL"   # must print NO_SCHEMA_CLIENT_DRIFT
bun run scripts/verify-migration-authority.ts   --url "$DATABASE_URL"   # must print 29/29
# the --watch servers pick up nothing new here; the fix is purely the database catching up
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' -d '{"email":"x@example.invalid","password":"not-real-123"}'   # 401, not 500
```

Three migrations are pending. All three are idempotent. The `DROP INDEX` statements are verified no-ops against this database. The measured work is 5 indexes on tables of 1.4 MB or less, three nullable columns, and autovacuum settings.

**Four `--watch` backend processes are running** (started 12:46 and 13:57). This is the documented "several backends at once" hazard. Every one of them runs schedulers against `homigo_db`. Stop all but one.

---

## 1. Environment

| | Start of pass | End of pass |
|---|---|---|
| C: free | 1.8 GB | **5.2 GB** (freed outside this session; it had dropped to 1.05 GB mid-pass) |
| D: free | 121 GB | 121 GB |
| Largest consumer on C: | `docker_data.vhdx` **66.7 GB** | unchanged |
| Reclaimable, and not used for anything else | npm-cache 1.22 GB, bun cache 1.01 GB, Temp 2.76 GB | **left untouched**: these are the owner's to clear |

Mid-pass, C: fell from 1.8 GB to 1.05 GB. The space went into the Docker vhdx (test rows and Prometheus TSDB), not into caches. I stopped disk-heavy work when I saw it. At under 2% free the **full 2,633-test suite was not run**, per the standing rule.

---

## 2. What Pass 5 found

### Fixed in this pass (P2)

| ID | Finding | Evidence | Proven to fail on reintroduction |
|---|---|---|---|
| **MIG-8** | No gate checked that the schema, the generated client and the live DB agree. The new `check-schema-client-contract` derives its expectations from `schema.prisma` itself: 218 models, 2,940 columns, 151 enums, and a bare find on every model. It is wired into CI. | On `homigo_db` it finds 10 drift items, all from one root cause. On `homigo_test` it passes. | ✅ Dropped `users.data_origin` → exit 1. Restored → exit 0. |
| **OBS-12** | `RedisDown` and `RedisDownP1` had identical expr, `for` and severity. One outage → two pages on two routes. The duplicate-*name* check could not see this because the names differ. | The new `reconcile-alert-rules` compares expressions across three layers. | ✅ Same expression → FAIL. Same name → FAIL. |
| **AI-2** | Nothing alerted on AI budget decisions, including `BUDGET_UNAVAILABLE`, which the code describes as "made loudly visible". Added two gauges and four alerts. | `AiSpendingWithoutBudgetPolicy` is **PENDING right now** (§5). | runtime-verified |
| **AI-3** | `hashArguments` was not order-stable: `stableStringify` never sorted keys. Both approval binding and idempotency depend on it. | 20 of 20 spendable approvals had unsorted keys, so they are all affected. All 20 are **already expired**, so changing the hash affects zero live approvals. | ✅ 4 assertions |
| **AI-4** | `NO_HANDLER` spent the approval and wrote no audit row. The 14 high-risk tools have 0 handlers between them, so this is the **only** outcome an approved high-risk request can have. | 10 of 43 consumed approvals point at executions that were never recorded. | ✅ |
| **SEC-12** | Seven places treat staging as a dev machine, because `.env.staging` ships `NODE_ENV=development`: (1) the **password-reset token** is printed to the console; (2) the auth burst limit can be bypassed by anyone using an `@homigo.test` address; (3) the same bypass on register; (4) the **service-start PIN** is printed; (5) the **login OTP** is printed, with no environment condition at all; (6) **every unhandled 500 returns internals** (source paths and code) to callers; (7) **email bodies are printed and reported as `delivered: true`**. | (6) was observed live: an unauthenticated login returned source paths. | ✅ every one |
| **ARCH-1** | Three separate copies of the "is this deployed?" predicate existed, so each fix above had been applied in isolation. Consolidated into `lib/deployed-environment`. `ops-auth` and `payment-mocks` now delegate to it. | | ✅ |
| **PRICE-1** | The pricing optimizer compared exact revenue against a *rounded* running best, so its choice depended on absolute scale. | base 0.1 → ×1.25; base 0.9 → ×1.30 (4%). | ✅ |
| **FIN-5** | The `reconcile:ledger` CLI posted plugging ADJUSTMENTs unconditionally and without a reason. The service defaulted to posting. | 0 of the 56 historical escrow plugs carry a reason. | ✅ 3 assertions. CLI refuses without `--reason` (exit 2). |
| **FIN-6** | `production-blocker-final.test.ts` asserted `PLATFORM_ESCROW` delta ≤ 0.01, an invariant Pass 2 had disproved. **It has failed at ₹149,550 ever since, and no regression run included it.** That was my regression in Pass 2. | All three invariant accounts are at 0 delta. | now passes |
| **DQ-9** | The provenance rule labelled a booking as certification if a certification refund had been raised against it. That holds for **1 of the 100** bookings it relabelled. Inheritance now requires the account, booking and refund to come from the same run. | 5 accounts; 62 bookings on accounts older than 7 days; 71 live-shaped gateway ids; 5 real reviews | ✅ 2 assertions |
| **OBS-13** | Refund alerts are now tested on *which rows* make them fire: a certification refund does not move the paged series, while REAL and UNKNOWN refunds do. | Drives the real sampler through `renderMetrics()`. | ✅ |

### Withdrawn: my own earlier claims

| Claim | Where it was made | Why it is withdrawn |
|---|---|---|
| "Certification traffic **moves customer prices**" via dynamic pricing | Pass 4 | Wrong on two counts. `base` factors out of the optimizer's argmax, and nothing customer-facing reads the service (`/api/pricing/*` has no consumer). Measured across 120 assertions. |
| "**GMV overstated by 22%**" | Pass 4, and repeated in code comments and test names in this pass | It rested entirely on DQ-9's rule. Re-derived with the corrected rule: **GMV 0.2% (₹500)**, completed revenue 1.7%. The refund-console figure (97.1%) **stands**, because it uses evidence on the refund row itself. **Corrected in Pass 6:** the 0.2% was computed against `users.email`, NULL for 794/882 users under PII encryption. With addresses resolved, account-level rules exclude **GMV 24.1% (₹60,134)**, customers 64.6%, bookings 34.0%, completed revenue 20.6% — see `enterprise-2035-data-quality-dq7.md` §3. The withdrawal of DQ-9's inheritance rule itself still stands. |
| "No AI alert firing is correct: no live inference configured" | Earlier in this pass | Wrong. The backend was stale and did not expose the gauge. Gemini and Groq keys are set and spend is real (below). |

Every place those claims appeared has been corrected: source comments, test labels, the DQ-7 doc and the Pass 4 board.

---

## 3. The subsystem board

| # | Area | Status | Evidence | Remaining blocker | Next action |
|---|---|---|---|---|---|
| 1 | Runtime/schema consistency | **BROKEN (P1)** | login and 2 public reads → 500 P2022 | migration not applied | OPERATOR_ACTION §0 |
| 2 | Migration authority | FIXED (gates) · OPERATOR_ACTION | contract gate proven both ways; 3 pending | deploy refused here | run `migrate deploy` |
| 3 | Database | ENVIRONMENTAL | `provider_match_scores`: **1 live row, 329 MB**; `otps` 20 MB of index bloat; `assignment_audits` 186 MB with no retention | VACUUM FULL needs headroom and a window | maintenance window after C: recovery |
| 4 | Finance | TEST_VERIFIED · BUSINESS_DECISION | debit = credit = ₹711,290.10 (paise agree), 0 unbalanced journals; ₹32 wallet drift preserved; escrow report: 56 plugs, net −₹17,245, ₹9,386 → ₹26,631 if reversed | reversal is an accounting call | `scripts/report-escrow-plugs.ts --csv` for the owner |
| 5 | Provenance | FIXED | inheritance corrected; gate proven failing on an undeclared write | backfill waits on the migration | backfill after §0 |
| 6 | Analytics | FIXED · re-measured | 118 sites classified by the `prebuild` gate; impact re-derived | — | — |
| 7 | Dynamic pricing | FIXED · claim withdrawn | invariance proven; rounding defect fixed | not customer-facing | — |
| 8 | Observability | RUNTIME_VERIFIED | **116 = 116 = 116**, 0 duplicates, 0 shared expressions, all `ok`; 114→113→112→116 accounted for rule by rule | — | — |
| 9 | Alert delivery | EXTERNAL_BLOCKED | receiver hop proven in Pass 4; no human channel credentials | Slack/PagerDuty/SMTP secrets | owner provisions a channel |
| 10 | Security | RUNTIME_VERIFIED | **43 probes**: 22 unauthenticated, 17 forged-token, 4 webhook-signature. All refuse, 5 public routes answer 200, and a negative control fails. RBAC/adversarial suites: 35/35. | — | run the probe after every deploy |
| 11 | Compliance | TEST_VERIFIED | 43/43; `/api/compliance/requests` refuses unauthenticated and forged callers | — | — |
| 12 | AI | FIXED · **BUSINESS_DECISION** | Gemini + Groq live, **0 budget policies**, spend today $0.0144; `AiSpendingWithoutBudgetPolicy` **PENDING** | the cap amount belongs to the owner; I did not invent one | set via `PUT /api/admin/governance/ai-budgets` (API only, no UI) |
| 13 | ETL | FIXED · RUNTIME_VERIFIED | the running gauge now reads `running 0 / abandoned 111`; before the restart the same database read `running 111` | BigQuery billing disabled | EXTERNAL_BLOCKED |
| 14 | Unwired APIs | RE-MEASURED | 704 routes: **591 wired**, 11 weak, 95 with no client (19 REAL_GAP, 49 API_ONLY, 8 DEPRECATE, 5 BUSINESS_DECISION, 3 EXTERNAL_BLOCKED, 2 BACKGROUND, 9 owner review). Matcher validated against its own output in both directions. | the old figure of 92 is superseded | per-row table: `enterprise-2035-unwired-pass5.md` |
| 15 | Customer Web | NOT RUN | — | login broken (§0), and C: | E2E after §0 |
| 16 | Partner Web | NOT RUN | — | same | same |
| 17 | Admin | NOT RUN | — | same | same |
| 18 | Mobile | EXTERNAL_BLOCKED | no device or emulator attached | hardware | — |
| 19 | Browser E2E | NOT RUN | — | §0 plus disk | after §0 |
| 20 | Full regression | NOT RUN | the 2,633 suite is still not run at <2% free. Targeted runs this pass: 174 + 100 + 77 + 43 + 36 + 35 + 19 + 13 + 7, all pass | disk | after C: recovery |
| 21 | Environment | ENVIRONMENTAL | C: 5.2 GB; vhdx 66.7 GB; 4 duplicate backends | owner | compact or move the Docker data root; stop the duplicate backends |

---

## 4. P3, all needing an owner decision

| ID | Decision needed |
|---|---|
| **OBS-9** | Minimum sample size for `ProviderAcceptanceLow`. It currently pages on n = 1. |
| **DQ-8** | Should certification jobs count toward a *real* partner's score, which drives payouts? |
| **DQ-10** | Are the 5 accounts behind the 100 refund-touched bookings QA accounts or real customers? Until someone decides, they count as business, which is the fail-safe direction. |
| **EVT-3** | A wildcard stub consumer holds 38% of `event_consumer_receipts`. Rewire it, narrow it, or drop it. |

---

## 5. New tools and gates this pass

| Tool | Proven to fail |
|---|---|
| `check-schema-client-contract.ts` (in CI) | ✅ stale column |
| `reconcile-alert-rules.ts` | ✅ duplicate name, ✅ duplicate expression |
| `probe-endpoint-authorization.ts` | ✅ wrong-target control |
| `inventory-api-consumers.ts` + `classify-unwired-routes.ts` | validated: 2 true misses and 16 correct verdicts among 18 challenges |
| `report-escrow-plugs.ts` | read-only; checked against measured global balance |
| `reconcile-ledger.ts` (dry run by default) | ✅ refuses without a reason |

---

## 6. What this pass learned about its own method

Four of this pass's own checks were wrong on their first run, and each would have produced a false result:

- The schema gate reported **18 missing enums**. 17 of them were `@@map` names.
- The unwired matcher missed calls built from template literals and demoted query-suffixed calls to weak matches.
- Two assertions matched text inside **comments** that explained the defect they were testing for. This is the fifth time in this engagement that has happened.
- My impact script used its **own copy** of the provenance rule. That copy is how the 22% figure survived for a whole pass.

Every one of them was caught the same way, by deliberately feeding the check something it had to fail on. That is the method this pass relied on, and it applies to this board too: nothing here should be trusted until it has been re-measured.
