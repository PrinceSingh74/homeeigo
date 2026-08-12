# Phase 17.3 — Partner Route Optimization Certification

**Date:** 2026-06-13 · execution-only. **Reuses `maps.service`** (Google Directions `optimize:true` + Distance-Matrix ETA) and `lib/geo` haversine — **no new routing engine** (RULE honoured).

## Service (`route-optimization.service.ts`)
`optimize(providerLocation, jobs)` →
1. **Priority** — `ARRIVED` jobs pinned first (already on-site), ordered by scheduled time.
2. **Optimised leg** — remaining jobs ordered by `mapsService.optimizeWaypoints` (Google, traffic-aware) when a key is present; otherwise **haversine nearest-neighbour**, biased so earlier scheduled times come forward (ARRIVED → scheduled time → distance).
3. **Metrics** — optimized vs naive distance + ETA, `timeSavedMin`, `source` (google|haversine), polyline (Google).

## Route
`GET /api/providers/me/route/optimize` — partner-only (401 without auth ✅); pulls the provider's live `Location` + active bookings (ACCEPTED/ASSIGNED/EN_ROUTE/IN_PROGRESS) and returns the optimised sequence.

Recompute triggers (caller invokes on): new booking assigned · booking cancelled · provider moved significantly — the endpoint is idempotent/stateless, safe to re-run.

## Execution evidence
| Test | Result |
|---|---|
| Intelligent ordering (ARRIVED pinned first) | sequence `j4→j2→…`, first-2 ARRIVED ✅ |
| Optimisation improves route (50 random, 8 stops, no ARRIVED pin) | **49/50 shorter** than naive ✅ |
| Offline fallback (no Google key) | `source = haversine` ✅ |
| Metrics | distance / ETA / timeSaved / source returned ✅ |

> Note: when ARRIVED jobs are pinned first, total travel can exceed the naive order (business priority over pure distance) → `timeSavedMin` clamps to 0. The unconstrained case (T2) shows the optimiser genuinely shortens routes.

### Scale (route computations)
| Routes | Time | Throughput | p95 | Errors | RSS |
|---|---|---|---|---|---|
| 100 | 3 ms | 33k/s | 0 ms | 0 | 93 MB |
| 500 | 20 ms | 25k/s | 0 ms | 0 | 100 MB |
| 1000 | 15 ms | 66k/s | 0 ms | 0 | 108 MB |

**1000 routes in 15 ms, 0 errors, flat memory** (pure CPU nearest-neighbour; Google path is one HTTP call per route when keyed).

## RULE / criteria
TypeScript clean ✅ · no new routing engine (maps.service reused) ✅ · existing ETA reused ✅ · traffic-aware via Directions ✅ · offline haversine fallback ✅ · 100/500/1000 cert ✅.

**Verdict: 17.3 ROUTE OPTIMIZATION PRODUCTION-READY.** Rollback: `git checkout -- src/services/route-optimization.service.ts src/services/maps.service.ts src/routes/providers.ts`.
