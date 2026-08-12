# HOMIGO Enterprise Scale Blueprint — 10k → 100k Users (REMEDIATION PHASE 4)

**Date:** 2026-06-18 · **Grounding:** the measured bottleneck is **per-node CPU/event-loop
saturation** (Phase 2/5: throughput plateaus ~120–145 req/s on one co-located box; Postgres
connections never saturate). The fix is **horizontal scale-out**, not vertical tuning. Per-request
latency is healthy (69 ms isolated), so the app code scales — it needs more nodes + a fan-out tier.

## Measured single-node capacity (real baseline)
- Sustained ~**130 req/s** booking reads per backend instance on the test rig (CPU-bound, co-located).
- A dedicated production node (no co-located load-gen/DB) realistically serves **several× that** —
  call it ~**300–500 req/s/node** conservatively; **must be re-measured on real infra** (not assumed).

## Target topology

```
                       ┌────────────┐
   Clients ──TLS──▶    │   CDN/WAF  │  (static assets, edge cache, DDoS)
                       └─────┬──────┘
                       ┌─────▼──────┐
                       │ Load Balancer (L7, sticky=off, health=/ready) │
                       └─────┬──────┘
        ┌──────────────┬─────┴────────┬──────────────┐
   ┌────▼───┐     ┌────▼───┐     ┌────▼───┐   (N stateless backend replicas,
   │ api-1  │ ... │ api-k  │ ... │ api-N  │    HPA-autoscaled on CPU/RPS)
   └───┬────┘     └───┬────┘     └───┬────┘
       └──────┬───────┴──────┬───────┘
        ┌─────▼─────┐  ┌─────▼──────┐
        │ PgBouncer │  │ Redis      │  ← Cluster (shards + replicas) for
        │ (txn pool)│  │ Cluster    │    cache / locks / pub-sub fan-out
        └─────┬─────┘  └────────────┘
     ┌────────▼─────────┐
     │ Postgres primary │──async──▶ read-replicas (reporting / heavy reads)
     └──────────────────┘
        ┌──────────────┐
        │ Queue workers│  (BullMQ/Redis or SQS) — dispatch, payments, notifications,
        └──────────────┘   settlement, log/retention — off the request path
```

## Capacity plan (re-measure on real infra; these are sizing targets, not certified numbers)

| Tier | 10k users | 25k | 50k | 100k |
|------|-----------|-----|-----|------|
| Backend replicas (stateless) | 3–4 | 6–8 | 12–16 | 24–32 |
| PgBouncer (txn pool, 2000 client→~20 server) | 2 (HA pair) | 2–3 | 3–4 | 4–6 |
| Postgres | 1 primary + 1 replica | +1 replica | partition hot tables + 2 replicas | partition + 3 replicas / consider Citus |
| Redis | single + replica | 3-node cluster | 6-node cluster | 6–9-node cluster |
| Queue workers | 2 | 4 | 8 | 16 |
| Autoscaling | HPA 50–70% CPU | same | same | same + cluster-autoscaler |

## Component decisions (each tied to a real finding)
1. **Stateless backend + HPA** — directly lifts the per-node CPU ceiling we measured. Backend is
   already stateless (JWT auth, Redis-backed sessions/rate-limit) → horizontally scalable as-is.
2. **PgBouncer (already deployed, Phase 4)** — transaction pooling lets N replicas share Postgres's
   `max_connections` (2000 client → ~20 server, proven). Run as an HA pair.
3. **Redis Cluster** — current single Redis does cache + locks + pub-sub + presence + WS fan-out.
   At scale, shard cache and isolate pub-sub; **fix the known no-auto-reconnect client issue**
   (carried from observability work) before multi-node.
4. **Read replicas** — route reporting/admin/analytics heavy reads off the primary (the 21 KB
   `ops-map`, 18 KB `provider/bookings` payloads from Phase 1 are replica candidates).
5. **Queue workers** — move dispatch matching, payment settlement, notifications, **and the
   `app_log_entries` retention purge** (Phase 2) off the request path.
6. **Table partitioning** — `app_log_entries` (now retention-capped) + `bookings`/`payments` by
   month at 50k+; combined with the **13 new FK indexes** (Phase 3) for join performance.

## WebSocket / realtime at scale
WS fan-out already uses Redis pub/sub (verified in prior phases). At scale: dedicated WS tier
behind a sticky LB (or a managed pub-sub), Redis cluster for room fan-out, presence sharded by user-id.

## Rollout & validation
1. Containerize + deploy 3 backend replicas behind an L7 LB (k8s Deployment + HPA).
2. **Re-run the Phase 5 load suite (100→10k) against the multi-node cluster** with the load
   generator on a *separate* host — this is what certifies true 10k throughput (the single-box
   ceiling is removed). **Until that runs, 10k cluster throughput stays BLOCKED, not PASS.**
3. Add per-node + aggregate dashboards (Grafana already provisioned) and autoscaling alerts.

## Verdict
**Blueprint DELIVERED** (design + sizing + component rationale tied to measured findings).
Actual multi-node throughput certification is **BLOCKED on real infra** — honestly not claimed
from a single laptop.
