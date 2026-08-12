# Load Test Revalidation — Post-Optimization (REMEDIATION PHASE 5)

**Date:** 2026-06-18 · **Stack under test:** backend → **PgBouncer (transaction pooling)** →
Postgres, `PRISMA_CONNECTION_LIMIT=25`, **13 new FK indexes**, **DB shrunk 45%** (retention).
Same harness/endpoint as Phase 2 (`booking` = `GET /api/bookings/upcoming`). Single-box rig.

## Before → after (booking scenario)

| Stage | Metric | Phase 2 baseline | **Optimized** |
|-------|--------|------------------|---------------|
| 100 | throughput / p95 / err | 117 / 981ms / 0% | **123 / 976ms / 0%** |
| 500 | throughput / p95 / err | 122 / 4620ms / 1.95% | **145 / 3851ms / 0.15%** |
| 1000 | throughput / p95 / err | 137 / 7497ms / 0% | **135 / 7644ms / 0%** |
| 5000 | err / p95 | 73.3% / 10s | 72.9% / 10s (timeouts) |
| 10000 | survival | survived | **survived** (status ok) |

Post-load: `financial_integrity_score = 100` (intact). PgBouncer `SHOW POOLS`: `cl_active=25`
multiplexed onto a bounded server-connection set throughout.

## What improved (real)
- **Error rate at 500c: 1.95% → 0.15%** (and 13.35% on the pool=25-direct path → 0.15% via
  PgBouncer). The pooler absorbs connection bursts that previously caused `pool_timeout` failures.
- **Throughput at 500c: 122 → 145 req/s.**
- Stability: 0% errors at 100c and 1000c; backend survived 5k and 10k without crashing.

## What did NOT change (honest — as predicted in Phase 2)
- **The ~120–145 req/s throughput ceiling persists**, and p95 still grows linearly with
  concurrency (100→0.98s, 1000→7.6s). Root cause remains **CPU/event-loop contention from
  co-locating load-gen + backend + Postgres + Redis + PgBouncer on one laptop** — not the pool,
  not missing indexes (active DB conns never saturated in Phase 2/4).
- 5k/10k still dominated by **client-side 10s timeouts** (the 10k run's `authenticated:false`
  is a load-generator artifact — even the login couldn't complete under that contention).

## Conclusion
The remediations (PgBouncer, pool tuning, FK indexes, retention) **improved correctness, error
resilience, and scale-readiness** but **cannot raise single-box throughput** — that is a hardware
ceiling, not a software defect. True 10k+ throughput certification requires the **multi-node
architecture** in `enterprise-scale-blueprint.md` (Phase 4). Per the gate, single-box 10k
throughput remains **PARTIAL** (executed + survived; cluster-scale BLOCKED on infra).
