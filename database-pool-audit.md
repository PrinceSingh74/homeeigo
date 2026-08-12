# Database Pool Audit

**Timestamp:** 2026-06-14T21:03:12Z – 2026-06-14T21:04:42Z  
**Evidence:** `measurements/database-pool-audit.json`, `measurements/api-cache-benchmark.json`, `measurements/database-pool-audit-run.log`

## Executive Summary

| Check | Before | After | Target | Result |
|-------|--------|-------|--------|--------|
| `/api/services` warm p95 | 164 ms (HTTP **500**) | **36 ms** (HTTP **200**) | <100 ms | **PASS** |
| `/api/stats/overview` warm p95 | 595 ms (HTTP **500**) | **30 ms** (HTTP **200**) | <100 ms | **PASS** |
| Pool exhaustion (P2037) | Present | Not observed in clean benchmark | 0× 500 | **PASS** |
| `pg_stat_activity` total connections | Not measured | **64** (58 idle) | <30 dev | **FAIL** |

**Root cause (before):** Multiple backend instances + default `connection_limit=25` saturated PostgreSQL (`FATAL: sorry, too many clients already`).

**Fixes applied:**
- Default Prisma pool: **8** connections in dev, **15** in production (`apps/backend/src/lib/database-url.ts`)
- Graceful `prisma.$disconnect()` on server shutdown (`apps/backend/src/index.ts`)
- Redis + L1 cache on stats/catalog (prior session, verified warm p95)

---

## pg_stat_activity Snapshot

| Metric | Value | Timestamp | Evidence |
|--------|-------|-----------|----------|
| `max_connections` | 100 | 2026-06-14T21:04:42Z | `database-pool-audit.json` |
| Total connections | 64 | 2026-06-14T21:04:42Z | `database-pool-audit.json` |
| Idle | 58 | 2026-06-14T21:04:42Z | `database-pool-audit.json` |
| Active | 1 | 2026-06-14T21:04:42Z | `database-pool-audit.json` |
| Prisma `connection_limit` | 8 | 2026-06-14T21:04:42Z | `database-pool-audit.json` |

**Recommendation:** Restart stale backend processes or run `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state='idle' AND datname=current_database();` during dev to reclaim 58 idle slots.

---

## API Latency (Clean Benchmark)

Run: single backend on `:3000`, `bun run scripts/api-cache-benchmark.ts`

| Route | Metric | Timestamp | Result | Evidence |
|-------|--------|-----------|--------|----------|
| `/api/services` | warm p95 **36 ms**, status **200** | 2026-06-14T21:03:12Z | **PASS** | `api-cache-benchmark.json` |
| `/api/stats/overview` | warm p95 **30 ms**, status **200** | 2026-06-14T21:03:12Z | **PASS** | `api-cache-benchmark.json` |
| `/api/services/featured` | warm p95 **21 ms**, status **200** | 2026-06-14T21:03:12Z | **PASS** | `api-cache-benchmark.json` |

---

## Redis

| Check | Timestamp | Result | Evidence |
|-------|-----------|--------|----------|
| Backend health `redis: ok` | 2026-06-14T21:01:52Z | **PASS** | `GET /health` response |

---

## Connection Leaks / Long Transactions

| Check | Result | Notes |
|-------|--------|-------|
| Multiple `PrismaClient` instances | **PASS** | Singleton in `apps/backend/src/lib/prisma.ts` |
| Shutdown disconnect | **PASS** | Added `prisma.$disconnect()` in `onStop` |
| Long-running idle connections | **FAIL** | 58 idle backends from prior dev sessions |
| Maintenance job connection hold | Not blocking | Jobs use shared singleton; API warm path unaffected |

---

## Rate-Limit Note

Burst audit (`database-pool-audit.ts` 10×20 requests) returned HTTP **429** after prior benchmarks. Use spaced sampling or off-peak windows for soak tests. Primary latency evidence uses `api-cache-benchmark.json` (all **200**).
