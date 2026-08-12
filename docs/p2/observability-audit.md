# HOMIGO — Observability Audit

**Date:** 2026-06-17 · live-verified against `/metrics` on the running backend.

## Metrics architecture (reused, no duplicates)
Single `/metrics` endpoint (`routes/observability.ts`) concatenates three emitters, all dependency-free:
- `lib/metrics.ts` — HTTP, feature, process/heap, redis, **+ new generic business registry** (`incCounter`/`setGauge`/`observeHist`) + live samplers.
- `lib/financial-metrics.ts` — payment/refund/payout/hcoin/chargeback/booking_created (reused).
- `lib/ops-metrics.ts` — ops counters/gauges (reused).

## Duplicate elimination (fixed this cycle)
| Metric | Was | Fix |
|---|---|---|
| `booking_created_total` | emitted by financial-metrics AND new code | use existing `recordFinancialMetric` only |
| `payment_success_total` | same | reuse existing |
| `ops_alerts_total` | `# TYPE` emitted per label-combo | `renderOpsMetrics` now emits one TYPE per name |
**Result:** `grep '^# TYPE' /metrics | uniq -d` → **empty (zero duplicate definitions)**.

## Live-verified metric inventory
```
booking_created_total           (financial-metrics)      live
dispatch_attempts_total 14      (assignment-engine)      live, real booking
dispatch_success_total          (onProviderAccepted)     live
booking_assigned/completed/cancelled_total               live
financial_integrity_score 100   (sampler, cached 60s)    live
provider_acceptance_rate 3.82   (sampler, attempts 24h)  live
db_connections_active 1 / idle 7 (sampler, pg_stat)      live
redis_up / redis_hit_rate       (redisClient)            live
google_api_calls_total{endpoint}/failures (maps.service) wired
http_requests_total / http_request_duration_seconds      live
```

## Gaps (honest)
- Spec metrics not yet dedicated counters: `websocket_connections_total`, `websocket_disconnect_total`, `location_updates_total`, `eta_calculation_total`, `db_slow_queries_total`, `redis_hits/misses_total` (tracking + redis hit-rate cover the intent; these are incremental adds).
- `db_query_duration_seconds` histogram helper exists (`observeHist`) but no Prisma middleware wired yet.

**Status:** PASS for the core business/financial/dispatch/DB/Redis/maps/API metrics — real-wired, verified live, zero duplicates.
