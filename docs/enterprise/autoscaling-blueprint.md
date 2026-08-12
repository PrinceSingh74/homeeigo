# HOMIGO Autoscaling Blueprint — 10k → 100k Users (GAP 4)

**Date:** 2026-06-18 · **Deliverable:** real, parse-validated Kubernetes manifests in `deploy/k8s/` + capacity plan grounded in the **measured** bottleneck (per-node CPU saturation; Postgres connections never saturate — see `enterprise-load-test-report.md`).

## Manifests (in-repo, YAML-validated)
| File | Objects |
|------|---------|
| `deploy/k8s/backend-deployment.yaml` | Deployment + Service + **HorizontalPodAutoscaler** |
| `deploy/k8s/pgbouncer-deployment.yaml` | Deployment (HA pair) + Service |
| `deploy/k8s/redis-cluster.yaml` | StatefulSet (6 nodes) + headless Service |
| `deploy/k8s/ingress-loadbalancer.yaml` | Ingress (L7 LB + TLS) + PodDisruptionBudget + Workers Deployment |

All 4 parse cleanly (each doc carries `kind` + `apiVersion`; 10 objects total). `kubectl --dry-run`
requires a live cluster API (offline here) — structural validation passed.

## Architecture
```
 CDN/WAF → Ingress(L7 LB, TLS, edge rate-limit, ewma) → homigo-backend (HPA 4–32 pods)
                                                            │
                          ┌─────────────────────────────────┼───────────────┐
                   PgBouncer (txn pool, HA×2)          Redis Cluster (6)   Queue Workers
                   2000 client → ~20 server            cache/locks/pubsub  (off req-path)
                          │
                   Postgres primary + read-replicas
```

## HPA (the measured lever)
CPU was the bottleneck, so the HPA scales on **CPU 65%** (+ memory 75%): `minReplicas 4`,
`maxReplicas 32`, fast scale-up (double / 30s), slow scale-down (25% / 60s, 5-min stabilization).
PDB `minAvailable: 3` keeps capacity during node drains.

## Capacity plan (sizing targets — re-measure on real cluster)
| Tier | 10k | 25k | 50k | 100k |
|------|-----|-----|-----|------|
| Backend pods (HPA) | 4 | 6–8 | 12–16 | 24–32 |
| PgBouncer | 2 (HA) | 2–3 | 3–4 | 4–6 |
| Postgres | 1 primary +1 replica | +1 replica | +2 replicas / partition | +3 replicas / Citus |
| Redis | 1+replica | 3-node | 6-node cluster | 6–9-node cluster |
| Queue workers | 2 | 4 | 8 | 16 |

## Why this lifts the measured ceiling
The single-box test plateaued at ~130 req/s due to **CPU contention** (load-gen + backend + DB
co-located). Stateless backend pods (JWT auth, Redis sessions) scale horizontally with **zero code
change**; PgBouncer (already proven, `pgbouncer-certification.md`) lets all pods share Postgres's
connection budget; Redis Cluster shards cache/pub-sub; workers move dispatch/settlement/retention
off the request path.

## Validation status (honest)
- Manifests: **authored + YAML-validated** in-repo.
- Live cluster throughput certification: **BLOCKED** on real k8s infra (no cluster in this env) —
  not claimed. The blueprint is deployment-ready; running the Phase-5 load suite against the
  deployed cluster (load-gen on a separate host) is what certifies true 10k+.
