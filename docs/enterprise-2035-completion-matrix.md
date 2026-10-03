# HOMEEIGO ENTERPRISE COMPLETION MATRIX

**2026-09-21, third remediation pass.**

---

## VERDICT

### ENTERPRISE TECHNICAL COMPLETION = **NOT ACHIEVED**

Both P1 engineering items from the previous pass are now **closed**. What remains is one P2
(`DQ-7`), one P3 reviewed-and-declined, and a set of items that are external, owner, operator or
environmental — plus one verification that could not be run safely.

---

## P0

**Count: 0.** No P0 engineering defect is open.

| Item | State |
|---|---|
| Data loss | None. Row counts identical before/after: bookings 705, payments 419, users 882, ledger_entries 2,295, journals 975, refunds 339, wallet_txns 56 |
| Money corruption | None. Global ledger `debit − credit = 0` |
| Production security | No unauthenticated exposure; verified by runtime probe, not inspection |
| Unsafe destructive migration | None. Both new migrations additive; safety gate passes |
| Authentication bypass | None. 401 on every protected surface incl. forged token |

---

## P1

**Count: 2 opened by earlier passes — both now FIXED.**

| ID | Item | State | Evidence |
|---|---|---|---|
| P1-A | Consent withdrawal + DSR status unreachable | **FIXED / TEST_VERIFIED** | 4 endpoints now have customer consumers; 8 assertions; contract-drift test **proven to fail** |
| P1-B | No durable business-data provenance | **FIXED / TEST_VERIFIED** | Migration (29/29 authority PASS), rule set (34 assertions vs live population), analytics policy, enforcement gate **proven to fail** |

Carried from previous passes, unchanged and still closed: MIG-1/2/3, FIN-1, FIN-4, SEC-9/10/11,
WFR-1, ETL-1, DBH-1, AI-1, OBS-1, OBS-2, REF-1, UNW-1.

**Open P1 engineering defects: 0.**

---

## P2

| ID | Item | State | Note |
|---|---|---|---|
| DQ-7 | Analytics call sites do not yet use `analyticsWhere()` | **OPEN** | Deliberately sequenced after the backfill review — changing reported KPIs before anyone has approved which rows are synthetic would produce unexplained movement |
| FIN-2 | 117 historical adjusting entries | **Mitigated** | Plugging narrowed to invariant-backed accounts; reversal is an accounting decision |
| OBS-3 | Refund observability thin (1 alert) | **FIXED** | 5 backlog metrics + 3 alerts, all verified non-vacuous against live data |
| OBS-4 | Alert delivery to a human unproven | **EXTERNAL_BLOCKED** | Needs a receiver |
| OBS-6 | Rule copies drift silently | **FIXED** | `check-alert-rule-drift` gate, proven to fail; staging regenerated from canonical |
| DBH-4 | `assignment_audits` retention | **BUSINESS_DECISION** | 173k rows / 186 MB |
| ETL-2/3 | ETL retention + abandoned-row reaper | **BUSINESS_DECISION** | Writes to `homigo_db` |

**Open P2 engineering defects: 1** (DQ-7 — sequenced behind a human review of the backfill).

---

## P3

| ID | Item | State |
|---|---|---|
| UNW-P3-1 | Body validation runs before authentication | **REVIEWED — not fixed.** Elysia runs the `body` schema in the validation phase, ahead of the auth plugin's hook. A framework-wide change to fix a structure leak with no data disclosure has a blast radius larger than the finding. Recorded, not bypassed |
| — | `BookingStatus.REJECTED` unreachable | **DOCUMENTED — recommend keeping** |
| — | Dead frontend constants | **OPEN** |

---

## DATA INTEGRITY

| Area | State |
|---|---|
| **Ledger** | `debit − credit = 0` globally; 975 journals, 0 unbalanced |
| **Wallet** | ₹32 residual, **fully attributed** to +₹1,000 orphan journal, +₹552 double-credit, +₹10 orphan, −₹200 ledger-only tip, −₹1,394 plugs. **Not plugged** |
| **H-Coin** | Reconciles exactly (₹380 = ₹380) |
| **Escrow** | Informational; **not** an invariant; no longer adjustable |
| **Provenance** | Column exists, rules tested against live population, policy module, enforcement gate. Backfill **not applied** — operator action |

---

## SECURITY

| Area | State |
|---|---|
| Auth | **RUNTIME_VERIFIED** — 401 on all protected surfaces + forged token |
| RBAC | Fails closed, 199 rules, denials audited |
| CORS | localhost removed from deployed allowlist |
| Webhooks | Authenticate-before-parse, content-hash idempotency |
| PII | `hashForLookup` fails closed; hash unchanged (no rehash forced) |
| Bypasses | 10 flags refused in staging **and** production; 8 assertions |
| Payments | Server-authoritative pricing; client sends ids + quantities only |
| Compliance | **Consent withdrawal + DSR status now reachable** |

---

## OBSERVABILITY

| Item | State |
|---|---|
| Canonical rules | **114**, `promtool` SUCCESS |
| Runtime loaded rules | **27 before fix** (verified via `/api/v1/rules`). Mount corrected; **recreate pending — OPERATOR_ACTION** |
| Money alerts at runtime | **0 of 8 were loaded** — including the one watching the ₹32 |
| Alertmanager | Running; **human delivery unproven** |
| Sentry | Dev no-op by design; production delivery unproven |
| Self-monitoring | `AdminAlertsNoSubscribers`, `DBDuplicateBackendSuspected` present |
| Rule drift | **GATED** — `check-alert-rule-drift`, mirrors byte-identical, proven to fail |

---

## AI

| Item | State |
|---|---|
| Control plane | **RUNTIME_VERIFIED** |
| Mock vs actual cost | **FIXED** — mocks cost 0; estimate on its own series; tool-loop covered |
| Budget | Enforcement real; **no policy configured — BUSINESS_DECISION**; UI unwired |
| PII | Field-allowlisted; **live verification EXTERNAL_BLOCKED** (a mocked call never leaves the process) |
| Approval binding | Order-sensitive hash + `NO_HANDLER` audit gap — **OPEN, not yet re-verified** |
| Tool governance | 13,146 executions, 13,108 policy logs |
| ML models | **EVALUATION-ONLY** — drive no decision, by design |
| Provider readiness | **EXTERNAL_BLOCKED** — no credential, and correctly gated behind budget + PII proof |

---

## DATABASE

| Item | State |
|---|---|
| Migration authority | **29/29 PASS** on live **and** on a migrations-only rebuild |
| Schema | 2 new additive migrations; safety gate passes |
| Indexes / constraints | Protected objects verified: slot exclusions, half-open `'[)'` ranges, slot columns, `search_vector`, `booking_unique_active_slot`, wallet idempotency |
| Autovacuum | 8 high-churn tables tuned |
| Bloat | ~399 MB unreclaimed — **OPERATOR_ACTION** (needs `ACCESS EXCLUSIVE`) |
| Retention | `assignment_audits` uncovered — **BUSINESS_DECISION** |

---

## ETL

| Item | State |
|---|---|
| Freshness | **Zero successes since 2026-08-19** |
| Scheduler | Running (which is why failures accumulate) |
| running / abandoned / recovering / failed | **Now distinguished** — was `running=111` on a dead pipeline, now `running=0, abandoned=111` |
| External blocker | **BigQuery billing disabled** |

---

## FRONTEND

| App | State |
|---|---|
| Customer web | tsc 0. **Compliance surface added** to existing settings section |
| Partner web | tsc 0. `lifecycle/pause` still unwired — **BUSINESS_DECISION** (dispatch semantics) |
| Admin | tsc 0. Stuck-workflow panel + fraud `unfreeze` wired |
| Mobile (×2) | **EXTERNAL_BLOCKED** — no physical devices |

---

## API CONSUMPTION

| Category | Count |
|---|---|
| Verified consumers | 570 → **574** (4 compliance endpoints added) |
| No automated match | 92 → **88** |
| Real orphans (product decision) | 24 |
| Background / ETL-blocked | 18 |
| API-only (correct) | 6 |

> The matcher is wrong in **both** directions (verified). Individual rows are leads; the aggregate is
> directional.

---

## TESTS

| Suite | Result |
|---|---|
| Targeted regression, 16 suites | **289 pass / 0 fail** |
| New tests this pass | 42 assertions (compliance 8, provenance 34) |
| Proven-to-fail controls | **5 total** — ledger scope, H-Coin double-journal, compliance contract drift, provenance declaration gate, alert-rule drift gate |
| Typecheck | backend, web, admin, partner-web — **4/4 exit 0** |
| Gates | migration-safety, ddl-guard, log-governance, **provenance-declaration**, **alert-rule-drift** — 5/5 PASS |
| **Full backend suite (2,633 baseline)** | **NOT RUN — ENVIRONMENTAL.** See below |

### A real regression was caught and resolved

The consolidated run failed **2 tests** in `p0-financial-races`. Per §22 this was treated as a stop
condition rather than a flake. Root cause: the regenerated Prisma client selects `data_origin` by
default, and `homigo_test` had not received the column — `P2022`. Classified as an environmental
prerequisite of the schema change, not a defect. The column was added additively to the test
database and the suite returned **282/0**.

---

## ENVIRONMENT

| Resource | State | Safe for heavy work? |
|---|---|---|
| **C:** | **1.80 GB free (0.6 %)** | **NO** |
| D: | 121 GB free | yes |
| Docker | 7.6 GB images, build cache 0 (pruned) | ok |
| Postgres | Up 9h, healthy, accepting connections | ok |
| Redis | Up 9h, healthy, `PONG` | ok |
| WSL | `Temp\wsl-crashes` = **446 MB** — corroborates the documented instability | — |

**Safe for the next heavy operation: NO.**

The documented failure chain is `C: → 0` → logging failure → Docker failure → **PostgreSQL
interruption**. Per §2 the full backend suite, large clones and parallel expensive jobs are blocked.

Reclaimable, **untouched** (all user-owned, classified per §2D):

| Class | Item | Size |
|---|---|---|
| SAFE_REGENERABLE | `Temp\DockerDesktopUpdates` | 599 MB |
| SAFE_REGENERABLE | `Temp\wsl-crashes` | 446 MB |
| SAFE_REGENERABLE | vscode installer temp ×3 | 629 MB |
| SAFE_REGENERABLE | `Temp\DiagOutputDir` | 240 MB |
| SAFE_REGENERABLE | `npm-cache` | 1.22 GB |
| SAFE_REGENERABLE | `.bun\install\cache` | 1.01 GB |
| **REVIEW_REQUIRED** | 13 certification databases | **3.5 GB** — `homigo_dr_cert` alone is 1,280 MB, larger than `homigo_db`. May hold DR evidence |

Done this pass: dropped only my own verification clones (`homigo_prov`, `homigo_migauth*`); kept
disposable output on `D:/homigo-ci-tmp`.

---

## REMAINING WORK, EXACTLY

**1. P1 engineering defects:** none.

**2. P2 engineering defects:** DQ-7 only (adopt `analyticsWhere()` at call sites — sequenced after the
backfill review).

**3. External blockers:** BigQuery billing · one AI provider credential · Resend · S3 · Expo ·
production Sentry DSN · Alertmanager receiver · physical devices.

**4. Business decisions:** reverse 56 escrow plugs (−₹17,245) · resolve the ₹32 · `assignment_audits`
retention · ETL restore-vs-retire · ETL reaper · AI budget figure · partner self-pause dispatch
semantics · customer-intelligence placement.

**5. Operator actions:** apply 2 migrations to `homigo_db` (+6 indexes and 3 nullable columns, no
drops, no data change) · recreate Prometheus to load 111 alerts · `VACUUM FULL`/`REINDEX` ~399 MB ·
review and apply the provenance backfill.

**6. Environmental blockers:** **C: at 0.6 % free** blocks the full suite and any large clone.

**7. Tests not run and why:** full backend suite (2,633 baseline) — stopped at C: 1.84 GB mid-run on
the previous pass and not restarted; browser E2E — not run under disk pressure; mobile — no devices.

**8. Runtime checks not possible:** 111 alerts loading (needs container recreate) · alert delivery to
a human (no receiver) · live AI inference and its PII scrub (no credential) · mobile (no devices) ·
production anything (no production runtime).

**9. Data integrity:** ledger balanced; counts unchanged; ₹32 attributed and preserved; no row
created, altered or deleted in `homigo_db` this pass.

**10. Next highest-value engineering action:** **recreate Prometheus** (one command) so the 114 canonical
rules actually load. Every alert fixed this session — including the three refund alerts that fire on
today's real data and the money-integrity alerts that were never running — is inert until that
happens. It is an operator action rather than an engineering one, which is precisely why it is the
next thing: no further code closes that gap.
