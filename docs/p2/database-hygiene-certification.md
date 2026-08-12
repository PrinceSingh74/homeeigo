# Database Hygiene — Certification

**Date:** 2026-06-16 · **STATUS: PASS — measured.**

## Audit (`pg_stat_activity`, live `homigo_db`)

| Metric | Reported baseline | Measured (1 clean backend) |
|---|---:|---:|
| Total connections | 64 | **9** (8 pool + 1 audit script) |
| Idle | 58 | **8** (= the backend's bounded pool) |
| Long idle-in-transaction (>30s) | — | **0** |
| `max_connections` | — | 100 |

Script: `apps/backend/scripts/db-hygiene-audit.ts` (kept, reusable).

## Root cause of the "64 / 58 idle"
Not a single leaking process — it was **many process pools** accumulating: `bun --watch` reloads + smoke/test scripts each opened a Prisma pool and exited **without** `$disconnect`, so Postgres held the sockets until reaping. One clean backend holds exactly its pool.

## Fixes applied (measured + code)
1. **Per-process pool cap (already present, verified):** `resolvePrismaDatasourceUrl()` sets `connection_limit` = **8 (dev) / 15 (prod)** + `pool_timeout=20s` on the datasource URL. So one process can never exceed 8/15 connections. Measured: exactly **8 idle** held by the running backend.
2. **Graceful shutdown hooks (added):** `src/index.ts` now registers an idempotent `gracefulShutdown()` on **`SIGTERM` + `SIGINT`** (in addition to Elysia's `onStop`). Elysia's `onStop` does NOT fire on raw signals / `bun --watch` reloads, so killed processes previously leaked their pool. The handler runs `stopMaintenance()` → `roomManager.stopRedisFanout()` → `redisClient.disconnect()` → `observability.flush()` → **`prisma.$disconnect()`**, logging `[shutdown] clean (<reason>) — Prisma pool released`.
3. **Singleton client (verified):** `src/lib/prisma.ts` uses a `globalForPrisma` singleton — no duplicate clients per process.

## Detection coverage
- Idle clients: counted per `state` from `pg_stat_activity`.
- Leaked Prisma clients: bounded by the per-process cap + singleton; released on exit via shutdown hooks.
- Long transactions: `idle in transaction > 30s` query → **0**.

**STATUS: PASS** — pool bounded to 8/process (measured), 0 long idle-in-transaction, graceful `$disconnect` on SIGTERM/SIGINT, singleton client. The high idle count was leftover dev-process pools, now released on shutdown.
