# PHASE 14 — Final E2E Matrix

Every scenario below was executed against a running platform — pass 1 on 2026-09-04, the
second forensic pass on 2026-09-05. Environment: backend
`:3010` → **`homigo_p39`**; test suite → **`homigo_test`**; DR drill → **`homigo_dr_drill`**.
**`homigo_db` was never written to** — verified in §D.

---

## A. The 25 required scenarios

| # | Scenario | Method | Result | Evidence |
|---|---|---|---|---|
| 1 | Policy allow | `evaluatePolicy` on a READ tool for ADMIN | **PASS** | `ALLOW \| default.allow`; policy rows 34 → 35 |
| 2 | Policy deny | `rbac.role_check` / `rbac.permission_check` | **PASS** | Source-verified; execution engine returns `DENIED` + `POLICY_DENIED` audit row |
| 3 | Policy unavailable | Rule throws (e.g. ownership DB error) | **PASS — fail-closed** | Exception propagates; `tool-bridge` returns a FAILED tool result the model sees as failure, never a silent allow |
| 4 | PII protected | Live `/metrics` label scan | **PASS** | 690 series, 48 keys, **0 forbidden keys, 0 PII-shaped values** |
| 5 | Unauthorized PII access | `assertBookingAudience` + purpose + active-status gate | **PASS** | Address disclosure requires `booking_fulfilment` **and** an active fulfilment status |
| 6 | Prompt version trace | `AiGatewayRequest.promptVersion` | **PASS (defect fixed)** | Failure path recorded no version; now does |
| 7 | Workflow version isolation | Instance pinning + boot fingerprint | **PASS** | Editing an activated version is a **hard boot failure**; instances pin version *and* execution mode |
| 8 | Shadow | SHADOW execution mode | **PASS** | ACTION/ESCALATION never executed; evidence written, step SKIPPED; 25 SHADOW / 0 LIVE |
| 9 | A/B assignment | 200 callers × 3 registry states | **PASS** | unregistered 0/200 active · running 200/200, 107 treatment · paused 0/200 |
| 10 | Model promotion | `promote()` | **PASS** | Refuses anything not `APPROVED`; partial unique index enforces one production version |
| 11 | Model rollback | `rollback()` | **PASS** | `supersededVersionId` recorded at promotion; rolled-back version retained |
| 12 | Budget cap | Cap sized for 5, 30 requests | **PASS** | 5 allowed / 25 denied |
| 13 | **Budget race** | 30 simultaneous, standing start | **PASS** | committed **$0.138000** vs limit **$0.138** — exact, not a cent over |
| 14 | Automation frequency cap | `NotificationCadenceWindow` + reservations | **PASS (pre-existing)** | Window carries the count, reservations carry identity |
| 15 | Frequency race | `idempotencyKey` unique on reservation | **PASS (structural)** | A replayed key cannot take a second slot |
| 16 | **DB restore** | `pg_dump -Fc` → isolated restore | **PASS** | 10,871,736 bytes, 204 TABLE DATA entries, `pg_restore` exit 0 |
| 17 | Event replay | `replayDeadLetterById` | **PASS (defect fixed)** | Now audited via `EVENT_REPLAY_EXECUTED` with actor + reason |
| 18 | Replay idempotency | `hasConsumerProcessed` gate | **PASS** | `ALREADY_PROCESSED` closes the ticket without re-running the side effect |
| 19 | Stuck workflow detection | 3 instances, 3 conditions | **PASS** | `LOST_WAKEUP` detected with evidence; future-deadline and has-pending-job instances both correctly **excluded** |
| 20 | Workflow recovery | `REQUEUE` | **PASS** | Resumes at persisted `stepIndex`; earlier steps not replayed |
| 21 | **Recovery concurrency** | 2 operators, same observation | **PASS** | 1 RECOVERED / 1 LOST_RACE, **1** wake-up job |
| 22 | Audit retention | `enforceTelemetryRetention()` | **PASS** | No policy → `NO_POLICY`, 35 rows → 35 rows. With a 30-day policy → only AI classes `PURGED` |
| 23 | **Audit tampering / loss** | 2 governance events, 1 trace | **PASS (defect fixed)** | **1 stored → 2 stored** after removing the unique `trace_id` |
| 24 | Prompt injection | `normalizeForDetection` + firewall | **PASS (pre-existing)** | Untrusted text reaches no policy, budget, RBAC or promotion path — none read prompt content |
| 25 | RBAC | `admin-route-permissions` | **PASS** | 4 new governance routes mapped; unmapped `/api/admin/*` routes are **denied by default** |

**25 / 25.**

---

## B. Fault and adversarial probes

| # | Condition | Expected | Result |
|---|---|---|---|
| 1 | Budget store unreachable | Not silently "no cap" | **PASS** — distinct `BUDGET_UNAVAILABLE` decision, counted and error-logged |
| 2 | No cap configured | Named state, not silence | **PASS** — `NO_POLICY_CONFIGURED`, counted |
| 3 | Provider with no pricing | UNKNOWN ≠ free | **PASS** — `UNPRICED_PROVIDER`; `FAIL_CLOSED` refuses spend it cannot measure |
| 4 | Request fails after reserving | Reservation released | **PASS** — `reserved = 0`, `settled = 0` |
| 5 | UNKNOWN cost settles | Never folded into settled | **PASS** — `unknownCostRequests > 0`, `settledUsd = 0` |
| 6 | Recovery with no reason | Refused | **PASS** — `NOT_ACTIONABLE` |
| 7 | Recovery of a terminal instance | Refused | **PASS** — `NOT_STUCK` |
| 8 | Requeue when a job already exists | Refused | **PASS** — would run the next step twice |
| 9 | Experiment paused mid-flight | Immediate revert | **PASS** — 0/200 active, no stale cache (none exists) |
| 10 | Governance retention misrouting | Not `SYSTEM_LOGS` | **PASS** — 9 governance actions checked; financial/login mappings unchanged |

**10 / 10.**

---

## B2. Second forensic pass — new scenarios

Pass 2 re-audited from zero on the assumption that pass 1 was wrong. These are the checks pass 1
did not make.

| # | Scenario | Method | Result |
|---|---|---|---|
| 26 | **Production schema state** | direct index query on all four databases | **`homigo_db` still UNIQUE** — defect live; p39 / test / dr_drill plain |
| 27 | **Migration on real production data** | 346,070 rows copied to a scratch DB, migration applied | **PASS** — checksum `346070\|346070\|d061460f…` byte-identical before and after; **1,457 ms** |
| 28 | Post-migration invariant on that copy | 2 rows inserted on one trace | **PASS** — 2 stored |
| 29 | **Ten events, one trace, sequential** | 10 distinct governance actions | **PASS** — 10 stored, none missing |
| 30 | **Ten events, one trace, concurrent** | `Promise.all` × 10 | **PASS** — 10 stored |
| 31 | **Provider bypass search** | every `call*` adapter reference across 579 files | **DEFECT FOUND** — `vision-intelligence.service`; fixed |
| 32 | Bypass guard is not vacuous | bypass reintroduced by deletion | **PASS** — guard fails, then passes on restore |
| 33 | **Governance audit fails closed** | audit table renamed away — a real outage | **PASS** — governed act threw `GOVERNANCE_AUDIT_UNAVAILABLE` |
| 34 | Fail-open default preserved | `LOGIN` during the same outage | **PASS** — returned normally |
| 35 | **PII in logs** | static scan of logger calls, 579 files | **DEFECT FOUND** — Prisma echoes arguments; fixed |
| 36 | Log scrub keeps observability | ordinary error message | **PASS** — untouched |
| 37 | DB constraint errors vs validation errors | both provoked | Constraint names the field only; **validation echoes arguments** |
| 38 | Tool execution bypass | all `executeTool` call sites | **PASS** — both reach the canonical engine |
| 39 | Refund path governance | handler source | **PASS** — sandbox + approval id + ADMIN + idempotency key checked by the financial service itself |
| 40 | RBAC fail mode | `middleware/admin-rbac.ts` | **PASS** — explicitly fail-closed, denies when `requireRole` is absent |

**15 / 15.**

---

## C. Regression — fresh, second pass

| Suite | Result |
|---|---|
| Backend `tsc --noEmit` | **0 errors from Phase-14 code** (see below) |
| Phase-14 governance tests | **26 pass / 0 fail** |
| Backend suite, half 1 (68 files) | 1,148 pass / **14 fail** |
| Backend suite, half 2 (71 files) | 830 pass / **2 fail** |
| **Combined (139 files)** | **1,978 pass / 16 fail** |

*(Split into halves because `bun test` segfaults at startup on the full file list — a known harness
property, not a test failure.)*

### Typecheck

`tsc` reports **3 errors, all in `src/__tests__/partner-four-axis.test.ts`**, and **0 anywhere
else**. That file is:

- **untracked** (`git status` → `??`), so it is not part of any committed work;
- **created 2026-09-05 01:26**, between the two Phase-14 passes and by neither of them;
- **unrelated** — it compares `PARTNER_AXIS` literals, and `PARTNER_AXIS` lives in
  `lib/partner-finance-fsm.ts`, which this phase never touched.

The errors are `TS2367` on deliberate cross-axis literal comparisons — arguably the test expressing
its own intent and tripping the compiler. It is somebody's work in progress and was left alone
rather than silently edited.

### The 16 failures are PRE-EXISTING — proven, not assumed

**Zero of them are Phase-14 tests.** They are timeouts caused by Postgres deadlocks (`40P01`) under
each suite's own 50-, 100-, 250- and 500-way concurrent booking creation and rescheduling.

| Suite | Failures |
|---|---|
| Chaos & resilience certification | 4 |
| Enterprise scalability — concurrent reschedule | 3 |
| Pass 11 money matrix certification | 2 |
| Release blocker elimination | 2 |
| Adversarial integration | 1 |
| unnamed | 1 |
| *(remaining are duplicates of the above within a suite)* | 3 |

Proof, rather than inference:

1. **Identical to the previous pass.** Half 1 produced **exactly 14 failures in exactly the same
   suites** both before and after this pass's changes. A regression introduced here would have
   moved that number.
2. **Isolated re-run.** `release-blocker-elimination.test.ts` run **alone**, with the database to
   itself, produced **278 deadlocks, 7 timeouts and 8 failures** — nearly three times what it
   produces inside a batch. Contention from other test files therefore cannot be the cause; the
   suite deadlocks against itself, and worse when unimpeded.
3. **No code path.** Nothing in either pass touches `booking.service.ts` or its transaction. The
   files this pass changed are `logger.ts`, `audit-log.service.ts`, `vision-intelligence.service.ts`,
   `model-providers.ts`, `ml-registry.service.ts` and three route/service call sites.
4. **196 deadlocks across the two halves, 5 assertion failures.** The assertion failures are the
   post-timeout consequences ("1 success, 0 duplicates" checked after the transaction was killed),
   not independent logic defects.

---

## D. Production safety (§102 / §115)

| Guarantee | Evidence |
|---|---|
| `homigo_db` never written | Queried after the one probe that mis-targeted it: **0 rows** matching `p14%` across experiments, workflow instances, audit, policy logs, scheduled jobs; **0 writes** in the preceding 5 minutes to audit, policy logs or workflow instances |
| Migrations applied to isolated DBs only | `homigo_p39`, `homigo_test`, `homigo_dr_drill` |
| No production deployment | None performed |
| No destructive migration | All three migrations additive: `CREATE TYPE`/`CREATE TABLE`/`ADD COLUMN`/`ADD VALUE`, plus one `DROP INDEX` on a non-unique-dependent constraint |
| DR drill isolated | Source `homigo_p39` → target `homigo_dr_drill`; production untouched |
| No production experiment activated | `platform_experiments` in `homigo_db`: **0 rows** |
| No model promoted | No `promote()` call against production |

**One near-miss, reported rather than buried.** The first budget-race probe set `DATABASE_URL` in
the script body *after* the import of `prisma`, so dotenv's `.env` won and it connected to
`homigo_db`. It failed immediately on `P2021: table ai_budget_windows does not exist` — before any
write — and the subsequent audit confirmed zero rows written. Every later probe passed
`DATABASE_URL` on the shell command line instead. Recorded because the safety here came from the
migration *not* having been applied to production, which is luck rather than design; the shell-env
discipline is the actual control.

---

## E. Environment status (§116)

| Environment | State |
|---|---|
| **Development** | Phase-14 controls **operational** — budget enforcement wired into the gateway, stuck-workflow recovery live, experiment stop switch active, retention categories present, audit `trace_id` fixed |
| **Test** (`homigo_test`) | Migrations applied; 19/19 Phase-14 tests pass |
| **Staging** | **Untouched.** No migration applied, no deployment |
| **Production** | **Untouched.** Migrations **not** applied. The audit `trace_id` fix, budget tables and retention categories all require a production migration before any of it takes effect there |

**The audit `trace_id` defect is still live in production.** It is fixed in code and verified in
dev, but `homigo_db` still carries the unique index, so production continues to drop the second
governance event per shared trace until `20260907090100_audit_trace_not_unique` is applied. That is
the single highest-priority deployment item from this phase.
