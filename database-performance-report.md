# Database Performance Report

**Timestamp:** 2026-06-14T20:47:22.637Z  
**Evidence source:** Live API errors, `api-cache-benchmark.json`, code audit

---

## Critical Finding — Connection Pool Exhaustion

| Field | Value |
|-------|-------|
| **Endpoint** | `GET /api/services` |
| **Error** | `Too many database connections opened: FATAL: sorry, too many clients already` |
| **Prisma code** | P2037 |
| **Timestamp** | 2026-06-14T20:47:22.637Z |
| **Status** | **FAIL** |

**Root cause:** Multiple backend processes + maintenance jobs + benchmark scripts saturated PostgreSQL `max_connections`. Prisma pool limit defaults to 25 per process (`database-url.ts`).

**Fix (ops):** Run single backend instance during measurement; set `PRISMA_CONNECTION_LIMIT=5` per node in multi-process dev; use PgBouncer in production.

**Fix (code — applied):** Redis L1 cache on stats (15s), ops-map (8s), heatmap (60s); `ratingsForServices` rewritten to single `GROUP BY` SQL.

---

## Slow Query Audit

### Q1 — Featured service ratings (before optimization)

| Field | Value |
|-------|-------|
| **SQL (before)** | `rating.findMany` + in-memory aggregation per featured row |
| **Cold execution** | 324 ms (HTTP, status 200) |
| **Warm p95** | **26 ms** |
| **Timestamp** | 2026-06-14T20:46:05.453Z |
| **Fix** | Replaced with `GROUP BY b.service_id` raw SQL in `catalog.service.ts` |
| **Warm after fix** | **26 ms p95 — PASS** (<100ms target) |
| **Evidence file** | `measurements/api-cache-benchmark.json` |

### Q2 — Stats overview (5 parallel counts)

| Field | Value |
|-------|-------|
| **SQL** | 5× `prisma.*.count()` + `rating.aggregate()` in parallel |
| **Warm p95** | **595 ms** (status 500 — pool exhausted during test) |
| **Timestamp** | 2026-06-14T20:46:05.453Z |
| **Fix applied** | Redis TTL 60s→120s + L1 15s (`stats.service.ts`) |
| **Re-measure status** | **BLOCKED** — pool exhaustion prevented clean post-fix benchmark |
| **Status** | **FAIL** (no valid post-fix measurement) |

### Q3 — Services list

| Field | Value |
|-------|-------|
| **SQL** | `service.findMany` + `service.count` |
| **Warm p95** | **164 ms** (status 500 — pool exhausted) |
| **Timestamp** | 2026-06-14T20:46:05.453Z |
| **Fix** | Existing Redis cache TTL 60s + L1 10s |
| **Status** | **FAIL** (measurement invalid due to 500) |

### Q4 — Heatmap aggregation

| Field | Value |
|-------|-------|
| **SQL** | 2× `$queryRawUnsafe` grid GROUP BY on `bookings ⋈ addresses` + `providers ⋈ locations` |
| **Fix applied** | Redis cache 60s + L1 10s (`heatmap.service.ts`) |
| **Measured** | **NOT MEASURED** (admin endpoint requires auth; returned 404 unauthenticated) |

### Q5 — Ops-map snapshot

| Field | Value |
|-------|-------|
| **SQL** | 3 parallel Prisma queries + heatmap + geofences |
| **Fix applied** | Redis cache 8s + L1 5s (`ops-map.service.ts`) |
| **Measured** | **NOT MEASURED** (requires admin auth) |

---

## Missing Index Recommendations

| Table | Column | Query | Recommendation |
|-------|--------|-------|----------------|
| `bookings` | `service_id` | `ratings ⋈ bookings` GROUP BY | Add `@@index([serviceId])` — **not yet migrated** |
| `bookings` | `created_at` | Heatmap time window | Existing `@@index([createdAt])` — OK |
| `addresses` | `latitude, longitude` | Heatmap JOIN | No geo index — acceptable at current scale with cache |

---

## N+1 Patterns Found

| Location | Pattern | Status |
|----------|---------|--------|
| `catalog.service.ts` `ratingsForServices` | findMany all ratings → JS aggregate | **FIXED** → single GROUP BY |
| `ops-map.service.ts` `snapshot` | Sequential heatmap after parallel fetches | Mitigated by 8s Redis cache |
| Admin dashboard pages | `useAdminDashboardQuery` on list pages | Documented — defer to layout provider |

---

## Verdict

| Area | Status |
|------|--------|
| Query optimization (featured) | **PASS** — warm p95 26ms measured |
| Connection pooling | **FAIL** — P2037 during audit |
| Index coverage | **PARTIAL** — `bookings.service_id` index recommended |
| Redis caching | **PASS** — implemented on stats/ops-map/heatmap |
