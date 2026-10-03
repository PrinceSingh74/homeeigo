# HOMEEIGO — Enterprise 2035 Runtime Status

What was **actually observed executing** on 2026-09-21, versus what merely exists in source.

Status model used throughout: `SOURCE_ONLY` · `SOURCE_PLUS_TEST` · `SOURCE_PLUS_RUNTIME` · `VERIFIED_RUNTIME`.

---

## 1. What was running at audit time

A full local stack was live. This is the single most important fact about this audit: conclusions below are backed by HTTP probes and SQL reads against a running system, not by reading code alone.

| Process | Port | Evidence |
|---|---|---|
| Backend (Bun + Elysia) | 3000 | PID 24852 — `bun.exe --env-file=.env run src/index.ts` |
| Customer web (Next.js) | 3001 | PID 3228 — `apps/web/node_modules/next/.../start-server.js` |
| Partner web (Next.js) | 3002 | PID 30508 — `apps/partner-web/...` |
| Admin panel (Next.js) | 3003 | PID 22656 — `apps/admin-panel/...` |
| Postgres (dev) | 5433 | container `homigo-postgres` |
| Redis | 6379 | container `homigo-redis`, `redis-cli ping` → `PONG` |
| Prometheus / Grafana / Alertmanager | 9090 / 3004 / 9094 | containers up 3h |
| Staging Postgres + pgbouncer | 5434 / 6433 | `homigo-staging-*`, healthy |

> **Caution carried into every conclusion:** this is a *developer* environment (`NODE_ENV=development`, `APP_ENV=dev`). It is **not** a production deployment. No production runtime exists. See `enterprise-2035-production-readiness.md`.

---

## 2. Live probe results (read-only)

### 2.1 Health and readiness — VERIFIED_RUNTIME

```
GET /health  -> 200
GET /ready   -> 200
GET /metrics -> 200 (80,863 bytes)
```

`/ready` payload (verbatim, 2026-09-20T22:52Z):

```json
{"status":"ready","environment":"dev",
 "checks":{
   "database":{"status":"healthy","latencyMs":2},
   "redis":{"status":"healthy","latencyMs":2,"topology":"standalone"},
   "memory":{"status":"healthy","rssMb":151,"heapUsedMb":49},
   "integrations":{"razorpay":{"configured":true},"razorpayWebhook":{"configured":true},
                   "email":{"configured":false},"sms":{"configured":true},
                   "jwt":{"configured":true,"accessExpiry":"1h","refreshExpiry":"30d"}},
   "boot":{"status":"healthy","degradations":[]},
   "events":{"outboxEnabled":true,"consumersEnabled":true,"status":"consistent"}}}
```

This single payload resolves several questions that source inspection could not: the event outbox **and** consumers are both on and mutually consistent; email is **not** configured; SMS and Razorpay are.

### 2.2 Public data endpoints — VERIFIED_RUNTIME

```
GET /api/services           -> 200 (12,518 bytes, real catalogue)
GET /api/services/featured  -> 200 (914 bytes)
GET /api/stats              -> 404   (route exists but is not mounted at this path)
```

### 2.3 Authorization — VERIFIED_RUNTIME

Every protected surface probed unauthenticated returned `401`, and a structurally-valid but unsigned JWT was also rejected:

| Probe | Result |
|---|---|
| `GET /api/users/me` (no token) | **401** |
| `GET /api/admin/users` (no token) | **401** |
| `GET /api/bookings/upcoming` (no token) | **401** |
| `GET /api/wallet/balance` (no token) | **401** |
| `GET /api/providers/me/withdrawals` (no token) | **401** |
| `GET /api/admin/governance/ai-budgets` (no token) | **401** |
| `GET /api/admin/users` with forged `Bearer` (bogus signature) | **401** |

Authentication is genuinely enforced at the edge, not merely declared.

### 2.4 Latency (local, unloaded — indicative only)

| Endpoint | 5 samples (s) |
|---|---|
| `/health` | 0.022, 0.018, 0.009, 0.011, 0.011 |
| `/api/services` | 0.057, 0.007, 0.008, 0.025, 0.007 |
| `/api/services/featured` | 0.009, 0.008, 0.007, 0.006, 0.007 |

These are single-client figures on a warm local process. They establish that no pathological N+1 dominates these three paths; they say **nothing** about behaviour under concurrency. See `enterprise-2035-performance-assessment.md`.

---

## 3. Evidence from `/metrics` (170 metric names registered, 11 families exposed)

Counters are cumulative since process start (~3h uptime at audit time).

### 3.1 The event system is genuinely executing — VERIFIED_RUNTIME

```
homigo_outbox_publish_total{result="success"}                                 151
homigo_domain_event_total{event_type="partner.presence.stale"}                147
homigo_domain_event_total{event_type="partner.presence.expired"}                2
homigo_domain_event_total{event_type="partner.location.stale"}                  1
homigo_domain_event_total{event_type="ops.alert.raised"}                         1
homigo_consumer_processed_total{consumer="metrics.v1",...}                     151
homigo_consumer_processed_total{consumer="ai-context-indexer.v1",...}          151
homigo_consumer_processed_total{consumer="agent-trigger",...}                    1
homigo_event_by_domain_total{domain="partner"}                                 150
homigo_scheduled_job_executions_total{job_type="agent.recovery_sweep"}           1
```

Publisher → outbox → three independent consumers, all advancing. This is the strongest single piece of evidence in the audit: the event-driven backbone is not decorative.

**Caveat:** every event observed is a *presence/liveness* event produced by internal sweeps. No booking, payment or partner-lifecycle business event fired during the observation window, because no business traffic occurred. Event **plumbing** is VERIFIED_RUNTIME; event **coverage of business flows** is SOURCE_PLUS_TEST.

### 3.2 Leader-election fell back to Postgres — VERIFIED_RUNTIME (degraded, but correct)

```
homigo_lock_fallback_total{key="maintenance:event_outbox",   reason="redis_unavailable"} 190
homigo_lock_fallback_total{key="maintenance:scheduled_jobs", reason="redis_unavailable"}  95
homigo_lock_fallback_total{key="assignment:processor",       reason="redis_unavailable"}  32
homigo_lock_fallback_total{key="maintenance:presence_sweep", reason="redis_unavailable"}  32
homigo_lock_lease_lost_total{key="maintenance:event_outbox"}                               2
```

`/ready` reports Redis **healthy (2 ms)**, yet the lock layer recorded ~349 `redis_unavailable` fallbacks. Both are true: the counters are cumulative and Redis was unreachable earlier in the process lifetime (container restart), while the health check reflects *now*.

Reading `src/lib/distributed-scheduler.ts:60-80`, `redis_unavailable` is emitted only when Redis cannot answer **and** the Postgres advisory anchor was acquired — i.e. the job still ran, with exclusivity guaranteed by Postgres instead of Redis. **The designed failover worked.** This is a positive reliability finding, not a defect. It does, however, evidence real Redis instability in this environment, which at multi-node scale would matter more.

### 3.3 Automation runs in shadow only — VERIFIED_RUNTIME

```
homigo_workflow_definitions{mode="SHADOW",status="ACTIVE"}  14
homigo_workflow_definitions{mode="SHADOW",status="DRAFT"}   11
homigo_workflow_instances{status="RUNNING"}                  1
homigo_workflow_stuck_detected_total{reason="EXPIRED_UNTERMINATED"} 16
```

Every workflow definition is `mode=SHADOW`. Confirmed in the database: **1,324 `SKIPPED` vs 438 `COMPLETED`** instances. The automation engine executes, observes and records — it does not act on the platform. That is a deliberate posture, not a bug, but it means "automation" today is measurement, not automation.

The stuck detector is real and firing (16 detections; 1 instance `RUNNING` since 2026-09-05, 8 `WAITING`).

### 3.4 AI is metered and costed — but the cost is of mocked calls

```
homigo_ai_daily_cost_usd        0.01435515
homigo_ai_brain_prompts_active  17
homigo_ai_brain_memory_total     3
homigo_prompt_registry_total{...} 17 across 9 categories
```

A non-zero AI spend is recorded although **no model provider key is configured**. The gateway meters its own dry-run responses. See `enterprise-2035-ai-ml-assessment.md` — this is the audit's most consequential AI finding.

### 3.5 Analytics/ETL is failing continuously

```
homigo_etl_jobs_running   111     <- rows stuck in RUNNING, oldest 2026-08-07
homigo_etl_jobs_failed_24h  3
homigo_data_quality_score 100
homigo_eta_training_ready   4
homigo_eta_missing_labels  23
homigo_eta_quality_score   69.6
```

See §4.2. Note that `data_quality_score = 100` is **not** fabricated — it is computed by `analytics/data-quality/engine.ts` against Postgres source data, and `data_quality_results` holds 5,905–7,581 rows with a max `evaluated_at` of 2026-09-20. The score is honest; it simply measures source data, not BigQuery delivery.

---

## 4. Evidence from the live database (`homigo_db`, 1,060 MB)

### 4.1 Money core is sound — VERIFIED_RUNTIME

| Invariant | Result |
|---|---|
| `SUM(debit_paise) - SUM(credit_paise)` over all `ledger_entries` | **0** |
| Same check in the float columns | **0** |
| Journals where debits ≠ credits (of 975) | **0** |
| `ledger_entries` rows with NULL paise | **0** |
| Payments with no parent booking | **0** |

975 journals / 2,295 ledger entries, perfectly balanced. Double-entry integrity holds.

### 4.2 The analytics ETL pipeline has been dead for over a month — BROKEN (environment-blocked)

```
etl_job_executions by status:
  SUCCEEDED  4660   2026-08-07 .. 2026-08-19   <- last success 2026-08-19
  RECOVERING 3148   2026-08-07 .. 2026-09-20   <- still accumulating
  FAILED     1539   2026-08-07 .. 2026-09-20   <- still accumulating
  RUNNING     111   2026-08-07 .. 2026-09-04   <- zombies, never reconciled
```

Root cause, read directly from `error_message`:

> `Billing has not been enabled for this project. Enable billing at https://console.cloud.google.com/billing. Partition expiration time must be less than 60 days while in sandbox mode` — 44 occurrences in 7 days
> `... DML queries are not allowed in the free tier ...` — 14
> `... Table expiration time must be less than 60 days while in sandbox mode.` — 14

Daily pattern is stable and ongoing (2026-09-20: 6 RECOVERING + 3 FAILED; 2026-09-17: 70 + 35).

Three distinct defects sit here:
1. **ENVIRONMENT_BLOCKED** — GCP BigQuery billing is disabled; no warehouse write can succeed.
2. **BROKEN** — 111 executions stuck in `RUNNING` since at most 2026-09-04 will never resolve; `homigo_etl_jobs_running` is therefore a permanently wrong gauge.
3. **DATA** — unbounded growth of `RECOVERING`/`FAILED` rows with no terminal state or retention.

### 4.3 Refund pipeline has a stranded cohort — BROKEN

| `refund_requests` status | Count | Max retry | Latest |
|---|---|---|---|
| FAILED | 250 | 5 (exhausted) | 2026-08-18 |
| INDETERMINATE | **53** | 2 | 2026-09-04 |
| COMPLETED | 36 | 0 | 2026-09-16 |

Exactly **53 `payments` rows sit in `REFUNDING`**, aged 16–35 days — a one-to-one match with the 53 `INDETERMINATE` refund requests. `REFUND_AUTO_RECOVERY_ENABLED` is **absent from `.env`**, so the recovery sweep that would resolve them is gated off. Refunds *do* still complete (latest 2026-09-16), so the path is not wholly broken — but this cohort is stranded and will stay stranded until recovery is enabled.

### 4.4 Wallet balances do not reconcile — DATA defect

| Check | Result |
|---|---|
| Users where `wallet_balance` ≠ Σ(`wallet_transactions`) | **24** |
| Total drift | **₹52,939** |
| Of those, users with **zero** wallet transactions | **11** (₹46,589) |
| Users with any wallet transaction | 19 |

11 users hold a non-zero balance with no transaction history at all — the signature of directly-seeded fixture balances rather than a money-path defect (the ledger itself balances exactly, §4.1). Only 2 of the 24 have obviously synthetic e-mail addresses, so this cannot be dismissed as "just test users".

**This must be treated as an open invariant, not a known-benign artifact**: there is currently no automated check asserting `users.wallet_balance == Σ wallet_transactions`. Whatever seeded these rows can seed them again.

### 4.5 Storage hygiene is badly degraded — P1

| Table | Exact rows | Total size | Last vacuum | Last autovacuum |
|---|---|---|---|---|
| `provider_match_scores` | **1** | **329 MB** | never | **never** |
| `enterprise_audit_logs` | 401,690 | 260 MB | never | **never** |
| `assignment_audits` | 173,197 | 186 MB | never | **never** |
| `otps` | **13** | **20 MB** | never | **never** |
| `refresh_tokens` | 14,593 | 26 MB | never | **never** |

`provider_match_scores` is the **largest object in the database and holds one row**. Retention deletion ran; space was never reclaimed. `otps` shows the same pattern at smaller scale. Across every table inspected, `last_vacuum` and `last_autovacuum` are both `never` — autovacuum is effectively not operating on this database.

Unbounded audit growth (`enterprise_audit_logs` 401k rows, `assignment_audits` 173k) has no retention applied either.

### 4.6 Migration history is not a clean record — P1

125 migrations applied; **3 are recorded as failed and rolled back**:

| Migration | Started | Rolled back |
|---|---|---|
| `20260816120000_automation_workflow_engine` | 2026-08-19 | 2026-08-19 |
| `20260817100000_notification_platform` | 2026-08-19 | 2026-08-19 |
| `20260825140000_audit_log_action_created_at_index` | 2026-08-25 | 2026-08-29 |

The objects these migrations create clearly exist (workflows and notifications both run), so the DDL was re-applied by some later path. The consequence is that **`_prisma_migrations` can no longer be trusted as a description of the schema**, which undermines any future `migrate deploy` against a fresh environment.

### 4.7 Booking / payment state distribution

```
bookings(704):  COMPLETED 255 | PENDING 184 | CANCELLED_BY_USER 103 |
                CANCELLED_BY_PROVIDER 65 | ACCEPTED 88 | EN_ROUTE 7 |
                ASSIGNED 1 | IN_PROGRESS 1 | REJECTED 1
payments(419):  SUCCESS 287 | INITIATED 55 | REFUNDING 53 | REFUNDED 21 | FAILED 3
```

The single `REJECTED` booking dates from **2026-06-09** and confirms the state-machine comment: `BookingStatus.REJECTED` is a legacy value with **no current writer** (verified — every `REJECTED` write in `src/` targets a different model). It is an unreachable state with one historical row.

`COMPLETED` bookings with no `earnings` row: **18**.

---

## 5. Static verification

| Check | Result |
|---|---|
| `apps/backend` `tsc --noEmit` | **exit 0** |
| `apps/web` `tsc --noEmit` | **exit 0** |
| `apps/partner-web` `tsc --noEmit` | **exit 0** |
| `apps/admin-panel` `tsc --noEmit` | **exit 0** |
| `homigo-mobile` `tsc --noEmit` | **exit 0** |
| `homigo-partner-mobile` `tsc --noEmit` | **exit 0** |

All six TypeScript projects compile clean. Note the standing caveat recorded in project memory: each frontend **hand-declares** backend response shapes rather than importing them, so a clean `tsc` across all six is *not* evidence that the wire contract holds.

`TODO` / `FIXME` / `HACK` / `XXX` in production source across all six apps: **0**.

---

## 6. Tests — what was and was not run

**218 backend test files** (212 in `src/__tests__`, 5 in `src/events/__tests__`, 1 in `src/lib/__tests__`), plus 68 frontend/mobile spec files.

**The backend suite was deliberately not executed.** Project memory records two hazards that make an unattended run unsafe during an audit: `bun test` invoked from the repo root bypasses the bunfig preload and writes to the **live** `homigo_db`, and a prior over-broad run deleted ~3,939 completed bookings. Running it would have mutated the very database this audit measures. This is a stated limitation, not an oversight — see §8.

CI (`.github/workflows/ci.yml`) does run: `tsc --noEmit`, migration-safety checks, DDL-guard coverage, log-governance gate, and targeted test files. A separate `e2e.yml` runs Playwright for all three web apps.

---

## 7. Subsystem status summary

| Subsystem | Status | Basis |
|---|---|---|
| HTTP API + routing | VERIFIED_RUNTIME | 200/401 probes |
| Authentication / authorization | VERIFIED_RUNTIME | 401 on 6 surfaces + forged JWT |
| Postgres | VERIFIED_RUNTIME | 2 ms, 1,060 MB, queried directly |
| Redis | VERIFIED_RUNTIME (unstable) | healthy now; ~349 historical fallbacks |
| Event outbox + consumers | VERIFIED_RUNTIME | 151 published, 3 consumers advancing |
| Scheduled jobs / maintenance | VERIFIED_RUNTIME | 22 timers; leader lock exercised |
| Double-entry ledger | VERIFIED_RUNTIME | global + per-journal balance = 0 |
| Booking state machine | SOURCE_PLUS_TEST | no live transition observed |
| Payments (Razorpay) | SOURCE_PLUS_RUNTIME | `configured:true`; no live charge made |
| WebSockets (5 routes) | SOURCE_PLUS_TEST | no socket opened during audit |
| Automation / workflows | VERIFIED_RUNTIME (shadow only) | 14 ACTIVE, all `mode=SHADOW` |
| Analytics / BigQuery ETL | **BROKEN** | zero successes since 2026-08-19 |
| LLM inference | **MOCKED** | no provider key; dry-run responses |
| ML models (2 logistic) | SOURCE_PLUS_TEST | offline evaluation only, no decision path |
| Sentry | CONFIGURATION_ONLY | DSN set, but dev is a no-op by design |
| Email (Resend) | **NOT CONFIGURED** | `RESEND_API_KEY` empty; `/ready` confirms |
| SMS (Twilio) | SOURCE_PLUS_RUNTIME | credentials set, `SMS_ENABLED=true` |
| Object storage (S3) | CONFIGURATION_ONLY | `S3_BUCKET` absent; local disk in use (21 MB, 8,746 files) |

---

## 8. Evidence that was unavailable

Stated explicitly so no conclusion above is read as broader than it is.

| Not verified | Why | How to close |
|---|---|---|
| Backend test suite pass rate | Unsafe to run against live `homigo_db` (documented data-loss incident) | Run from `apps/backend` against an isolated test DB with `--timeout 45000` |
| Production behaviour of anything | **No production runtime exists** | Deploy staging first |
| Live booking→payment→dispatch→completion flow | Would mutate live data and could hit real Razorpay keys | Run on an isolated DB with mock gateway |
| WebSocket delivery under reconnect/scale | No client connected during audit | Drive `scripts/smoke-ws-fanout.ts` on isolated stack |
| Mobile runtime behaviour | Requires physical devices / dev builds; Expo Go is impossible (native modules) | USB dev build per documented workflow |
| Real LLM behaviour, cost, latency | No provider API key configured | Supply one key in a sandboxed env |
| Behaviour under concurrency | Single-client probes only | `bun run load-test:500` on isolated stack |
| Email delivery | `RESEND_API_KEY` empty | Supply key |

---

## Pass 6 note (2026-09-21)

- The `assignment_audits` row in the table above (173,197) was `reltuples`, stale. `count(*)` is
  **431,710**; growth this week is single digits to low tens per day. See
  `enterprise-2035-database-hygiene.md`, "Pass 6 re-measurement".
- Backends: **one** `bun --env-file=.env run --watch src` process on `:3000` (pid started 15:37 IST,
  restarted by the watcher on this pass's `src/` edits). The duplicate seen earlier in the pass is gone.
  16 client connections, all with an empty `application_name` — attribution by name is still not
  possible from the database side.
- Customer web (`apps/web`) on `:3001`: a `next dev -p 3001 --turbopack` server started 2026-09-20
  23:06 is listening on `[::]:3001`, has used 4,780 CPU-seconds and 1.35 GB, and **answers nothing**
  (both `127.0.0.1` and `[::1]` time out). Partner (`:3002`) and Admin (`:3003`) answer 200.
  **OPERATOR_ACTION**: restart it. Not killed here.
- Prometheus (`:9090`) and Alertmanager (`:9093`) are up; alert rules canonical = mirror = runtime = 116.
