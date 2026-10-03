# HOMEEIGO — Enterprise 2035 Performance Assessment

**Scope honesty first:** the only performance evidence gathered in this audit is single-client latency against a warm local process, plus static inspection and metric counters. No load test was run — doing so would have mutated the live database this audit was measuring. Everything below is labelled accordingly.

---

## 1. Measured (single client, local, warm)

| Endpoint | 5 samples (seconds) | Observation |
|---|---|---|
| `GET /health` | 0.022, 0.018, 0.009, 0.011, 0.011 | DB + Redis check each ~2 ms |
| `GET /api/services` | 0.057, 0.007, 0.008, 0.025, 0.007 | 12.5 KB catalogue; first call cold |
| `GET /api/services/featured` | 0.009, 0.008, 0.007, 0.006, 0.007 | |

`/ready` reports `database.latencyMs: 2`, `redis.latencyMs: 2`, `rssMb: 151`, `heapUsedMb: 49`.

**What this establishes:** no pathological N+1 dominates these three read paths, and process memory is modest. **What it does not establish:** anything about concurrency, connection-pool behaviour, lock contention or tail latency.

---

## 2. Known performance work already done (from code + project memory)

These are recorded as completed and are visible in the source:

| Fix | Evidence | Effect |
|---|---|---|
| **Auth: 4 round trips → 1** | `src/plugins/auth.plugin.ts:58-88` — one raw `LEFT JOIN` over `users`/`admin_users`/`user_auth_epochs` + `EXISTS` on `token_blacklist`, replacing Prisma's split nested-relation queries | **+60 % throughput**, fixed the heartbeat gate. Measured at 13,212 calls each. |
| **Isolation level on booking create** | SERIALIZABLE page-predicate locks made unrelated creators conflict | p99 was **7.3 s** — the isolation level, not the hardware |
| **Frontend shared JS 227 → 188 kB** | `framer-motion` `LazyMotion`, lazy Sentry replay | −69 kB per route (customer web) |
| **pgbouncer transaction pooling** | `docker-compose.yml` — `MAX_CLIENT_CONN 2000`, `DEFAULT_POOL_SIZE 20` | thousands of client conns share a small server budget |
| **Redis memory cap** | `--maxmemory 512mb --maxmemory-policy allkeys-lru` | cache can no longer OOM Redis or fail writes under load |

The `docker-compose.yml` comments show the reasoning was explicit: default `maxmemory 0 / noeviction` was identified as a scale hazard and fixed.

---

## 3. Database performance — the dominant risk

### PERF-1 (P1, DATABASE) — ~⅓ of the database is dead space

| Table | Exact rows | Size | Last (auto)vacuum |
|---|---|---|---|
| `provider_match_scores` | **1** | **329 MB** | **never** |
| `otps` | **13** | **20 MB** | **never** |
| `enterprise_audit_logs` | 401,690 | 260 MB | **never** |
| `assignment_audits` | 173,197 | 186 MB | **never** |
| `refresh_tokens` | 14,593 | 26 MB | **never** |

Database total: **1,060 MB**. The largest object holds one row.

**Performance impact:** any sequential scan on `provider_match_scores` reads 329 MB to find one row; index scans traverse bloated indexes. Backup, restore and DR drill times all scale with the dead space. Autovacuum never having run on *any* inspected table means the planner is also working from stale statistics.

**Actions:** `VACUUM (FULL, ANALYZE)` the two worst tables in a maintenance window (takes ACCESS EXCLUSIVE); then fix autovacuum thresholds so it cannot recur; then apply retention to the audit tables.

### PERF-2 (P2, DATABASE) — index-to-table ratio

937 indexes across 220 tables (~4.3 per table), with 1,838 CHECK constraints. Strong for read correctness, but every index is write amplification on the hot path — and `bookings`, `payments` and `assignment_attempts` are write-heavy.

No unused-index analysis was performed. **Action:** run `pg_stat_user_indexes` for `idx_scan = 0` over a representative window and drop genuinely unused indexes on write-hot tables.

### PERF-3 (P2, DATABASE) — connection-pool traps (documented, verify)

Project memory records two real traps that are easy to reintroduce:
- `FOR UPDATE` on `bookings` blocks FK inserts from another connection — must be `FOR NO KEY UPDATE`.
- Base-client calls inside a money transaction exhaust the pool — must use sequences.

Both are fixed; neither is currently guarded by a test that would catch a regression.

---

## 4. Performance-critical paths — status

| Path | DB work | External | Verified | Risk |
|---|---|---|---|---|
| `service_list` | single query | — | **measured 7–57 ms** | low |
| `service_detail` | catalogue + JSONB | — | not measured | low |
| `search` | Postgres `contains` (not FTS) | — | not measured | **scales poorly past a few thousand services** |
| `quote` / `booking_create` | multi-table tx, slot exclusion | — | not measured | **known 7.3 s p99 under SERIALIZABLE (fixed)** |
| `payment` | tx + ledger | Razorpay | not measured | medium |
| `webhook` | dedup claim + tx | — | not measured | low — idempotent by design |
| `dispatch` | 30 s tick, provider scan | — | **runs live** | see PERF-4 |
| `accept` | locked tx, offer closure | — | not measured | medium |
| `tracking` / `heartbeat` | presence writes | — | **147 presence events observed** | see PERF-5 |
| `wallet` | ledger read | — | not measured | low |
| `admin dashboard` | many aggregates | — | not measured | **medium — aggregate-heavy** |

### PERF-4 (P2, PERFORMANCE) — dispatch tick is a full scan every 30 s

`ASSIGNMENT_INTERVAL_MS = 30_000`; `assignment-engine.service.ts` (1,069 lines) scans candidate providers per pending booking. At 324 providers and 184 `PENDING` bookings this is trivial. At 10k providers it is not, and there is no index-assisted geospatial prefilter evident in the matching path — `matching.service.ts` computes `distanceKm` in application code after loading candidates.

**Action:** before scale, push the distance prefilter into Postgres (PostGIS or a bounding-box index) so the candidate set is bounded by the database, not by the process.

### PERF-5 (P3, PERFORMANCE) — presence sweep dominates event volume

Of 151 events published in ~3 h uptime, **150 were partner presence/location events** (`partner.presence.stale` ×147). `PRESENCE_SWEEP_INTERVAL_MS = 30_000`. Every one fans out to three consumers (`metrics.v1`, `ai-context-indexer.v1`, plus `agent-trigger` where applicable), each writing `event_consumer_receipts` — already at 18,713 rows / 11 MB.

With zero business traffic, presence sweeps are generating essentially all event-system load and receipt growth. This will not scale linearly in a useful direction.

**Action:** suppress `presence.stale` events for partners already known stale (emit on transition, not on every sweep), and apply retention to `event_consumer_receipts`.

---

## 5. Scheduler load

`src/lib/maintenance.ts` (749 lines) runs **22 concurrent `setInterval` timers** in-process:

| Interval | Jobs |
|---|---|
| 20 s | ops alert dispatch |
| 30 s | assignment dispatch, presence sweep |
| 5 min | alert evaluation, refund retry |
| 1 h | OTP cleanup, reconcile, integrity, token cleanup, retention tick, AI-brain maintenance, incentive eval, compliance expiry, backup |
| 6 h | partner score refresh |
| 24 h | finance reconcile, settlement sync, deletion, archival, location retention |

All exclusive jobs run under `runWithLeaderLock` with a Redis lease renewed at TTL/3 and a **Postgres advisory-lock fallback** — which was observed working in production runtime (~349 fallbacks, see `enterprise-2035-runtime-status.md` §3.2).

### PERF-6 (P2, ARCHITECTURE) — schedulers are in-process with the API

Every timer shares the API process's event loop, CPU and connection pool. A slow backup (`BACKUP_TIMEOUT_MS` defaults to 15 min) or a heavy integrity run competes directly with request handling. Leader locking prevents *duplicate* work across nodes; it does not isolate scheduler work *from* request work.

**Action:** extract schedulers into a separate worker deployment sharing the same image and lock mechanism. This is the single most valuable structural change for scale-readiness, and the leader-lock layer already makes it safe.

---

## 6. Frontend performance

| App | Shared JS | Notes |
|---|---|---|
| `apps/web` | **188 kB** (was 227 kB) | `LazyMotion` + lazy Sentry replay |
| `apps/partner-web` | **~227 kB** | project memory: shipped the pre-optimisation figure with eager imports |
| `apps/admin-panel` | not measured | 105 pages, heaviest surface |

### PERF-7 (P2, FRONTEND) — optimisations do not propagate between apps

Project memory records this directly: *"perf fixes never propagate; partner-web shipped 227 kB shared JS (apps/web's pre-optimization figure)."* With no shared package layer, every improvement must be re-applied by hand in three codebases — and demonstrably was not.

This is the same root cause as ARCH-1 (no shared packages) in the dead-code report.

**Other frontend notes:**
- Route-level `loading.tsx` present (e.g. `wallet/loading.tsx`) — good streaming behaviour.
- `DIGITAL_TWIN_POLL_MS` polling with `refetchIntervalInBackground: false` — correct.
- Project memory: service catch-all routes need `next.config` redirects + `dynamicParams = false`; a root `loading.tsx` streams a 200 and masks 404/308.
- Customer home page was 312 kB at one point (project memory, enterprise scale audit).

---

## 7. Known scale ceiling

Project memory's enterprise scale audit recorded the ceiling as **CPU-bound, not pool-bound**, with `LOAD_TEST_MODE=1` used to disable rate limiting during tests. That flag is **currently set in `.env`** (see SEC-3) — which means any informal throughput observation made in this environment is running without rate limiting and is not representative of production.

Load harness exists and is unused in this audit:
```
bun run load-test:100 | :500 | :1000
k6: booking.js, payment.js, wallet.js
```

---

## 8. Findings

| ID | Severity | Class | Finding |
|---|---|---|---|
| PERF-1 | **P1** | DATABASE | 329 MB table with 1 row; autovacuum never run; ~⅓ of DB is dead space |
| PERF-6 | P2 | ARCHITECTURE | 22 schedulers share the API event loop and pool |
| PERF-4 | P2 | PERFORMANCE | Dispatch distance filtering in application code, not the database |
| PERF-7 | P2 | FRONTEND | Perf fixes do not propagate; partner-web ~39 kB behind customer web |
| PERF-2 | P2 | DATABASE | 937 indexes, no unused-index analysis, write-hot tables |
| PERF-3 | P2 | DATABASE | Pool/lock traps fixed but unguarded by regression tests |
| PERF-5 | P3 | PERFORMANCE | Presence sweep generates ~99 % of event volume and receipt growth |

## 9. What must be measured before any production claim

1. Load test at 100 / 500 / 1000 concurrent **on an isolated stack** with `LOAD_TEST_MODE` **off** (so rate limiting is in play).
2. p50/p95/p99 for `booking_create`, `payment`, `accept`, `search`, admin dashboard.
3. `pg_stat_statements` top-20 by total time; `pg_stat_user_indexes` for unused indexes.
4. Connection-pool saturation under load through pgbouncer.
5. WebSocket fan-out at realistic connection counts (`scripts/smoke-ws-fanout.ts`).
6. Frontend Lighthouse/LCP for all three web apps — partner-web and admin-panel have never been measured.
