# Scale Readiness Report — HOMIGO V5

**Targets:** 100k+ customers, 25k+ partners, multi-city/state. DAU tiers: 10k / 50k / 100k.

## Infrastructure present (fact-checked from code)
| Capability | Status | Evidence |
|---|---|---|
| Redis read-through cache (L1+L2) | ✅ | `src/services/cache.service.ts`, `lib/redis.ts` |
| Rate limiting (Redis-backed) | ✅ | `middleware/api-rate-limit.middleware.ts`, `rate-limit.middleware.ts` |
| WebSocket horizontal scale (Redis pub/sub fanout) | ✅ | `lib/websocket.ts` (`ws:fanout`, `initRedisFanout`) |
| Assignment queue with distributed leader lock | ✅ | `services/assignment-engine.service.ts` (`assignment:processor` lock) |
| DB indexes | ✅ | schema.prisma: **325 `@@index`**, **84 `@unique`** |
| Connection pooling + PgBouncer | ✅ | `lib/database-url.ts`, `deploy/k8s/pgbouncer-deployment.yaml` |
| K8s HPA + manifests | ✅ | `deploy/k8s/backend-hpa.yaml`, `redis-cluster.yaml`, `postgres-primary.yaml`, `queue-workers.yaml` |
| Load testing harness | ✅ | k6 (`scripts/load-test/k6/booking|payment|wallet.js`), Artillery, Bun runner; npm `load-test:100/500/1000` |
| Idempotency cache | ✅ | `middleware/idempotency.middleware.ts` |

Existing docs: `docs/enterprise/homigo-scale-readiness-certification.md`, `enterprise-scale-blueprint.md`, `autoscaling-blueprint.md`, `load-testing-report.md`, `database-optimization-report.md`.

## Capacity planning (recommended validation runs)
| Tier | Concurrency assumption (~2% of DAU) | Action | Tool |
|---|---|---|---|
| 10k DAU | ~200 concurrent | `npm run load-test:100` → `:500` ramp | k6 |
| 50k DAU | ~1,000 concurrent | `npm run load-test:1000` | k6 |
| 100k DAU | ~2,000 concurrent | multi-node cert: `scripts/enterprise/multi-node-certification.ts` | k6 + HPA |

## Bottleneck analysis (predicted, to validate under load)
1. **Postgres write hot paths** (bookings, payments, assignment) — mitigated by indexes + PgBouncer; validate connection-limit headroom at 2k concurrency.
2. **Assignment engine** single-leader drain — verify throughput; scale `queue-workers` replicas if backlog grows (`observability/health.queue.assignmentBacklog`).
3. **WebSocket fanout** — Redis pub/sub scales horizontally; validate Redis CPU at 50k persistent connections; consider Redis Cluster (`redis-cluster.yaml`).
4. **Hot read endpoints** (dashboard, exec-kpis, heatmap) — already Redis-cached; confirm cache hit-rate ≥90% under load (`health.redis.hitRate`).

## Load testing report (how to produce runtime evidence)
```
# backend
npm run load-test:100      # smoke
npm run load-test:1000     # 50k-DAU proxy
npm run k6:booking && npm run k6:payment && npm run k6:wallet
npx tsx scripts/enterprise/multi-node-certification.ts   # 100k tier
```
Capture p50/p95/p99 latency, error rate, and Redis/DB saturation; attach to this report.

## Gaps
- **BullMQ not used** — assignment queue is custom Prisma-table-drained. Fine at current scale; document max sustained throughput from load tests.
- **No autocannon**; k6/Artillery cover the need.
- Runtime p95 evidence at each DAU tier is **pending an executed load run** against seeded staging.

## Verdict
**Architecture is scale-ready by design** (cache, fanout, pooling, indexes, HPA, load harness). Certification to 100k DAU requires executing the load runs above and attaching p95 evidence — the harness and manifests already exist.
