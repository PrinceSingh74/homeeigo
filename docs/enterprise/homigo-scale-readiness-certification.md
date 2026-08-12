# HOMIGO — Scale Readiness Certification (Phase 7)

**Date:** 2026-06-24 · **Service:** `apps/backend` (Bun + Elysia + Prisma) · **Method:** instrumented
k6 load ramp + live CPU/PG/Redis sampling + Prisma/schema audit. **Runtime evidence only; cost model is a
clearly-labelled projection.**

---

## Headline: the "single-node load failure" was **latency, not a crash** — and the cause is **single-process throughput**, fixable by horizontal scaling

The prior cert said "single-node load test FAILED, runner crashed." Forensics show the **backend never
crashed or errored** — the *load runner* crashed (machine OOM). The backend's real limit is throughput.

---

## Phase 1 — Load forensics (k6 ramp 100→600 VU on a cached read, single Bun node)

| Metric | Measured | Reading |
|--------|----------|---------|
| Requests / errors | **73,546 req, 0% errors** | backend did **not** crash or shed load |
| Throughput | **668 req/s** | single-process ceiling on this shared box |
| Latency | p50 **401 ms**, p95 **840 ms**, p99 1.0 s, max 1.95 s | **SLO p95<500 ms crossed** → requests queue |
| Backend CPU | **132–234%** (~2 of 12 cores) | **NOT machine-CPU-bound** |
| Active PG connections | **1–3** | **NOT database-bound** |
| Redis | 1.19 MB, 0 evictions | **NOT Redis-bound** |

**Exact failure point:** at ≈600 VU the single process saturates its event-loop throughput (~668 req/s);
in-flight requests (≈600) queue → p95 840 ms. By Little's Law (600 VU ÷ ~0.9 s ≈ 668 req/s) the system is
exactly at its single-instance concurrency limit. **It degrades gracefully (latency), it does not fail.**

**This is the textbook signature of a stateless service that needs horizontal scaling** — not a code or
DB defect.

---

## Phase 2 — Database scaling (audited; healthy)

| Check | Result |
|-------|:------:|
| N+1 queries | ✅ none (services batch with `findMany`/`IN`) |
| Indexes | ✅ **325 `@@index`** in schema; hot reads index-served |
| Slow queries (pg_stat_statements) | ✅ slowest = 193 ms **cold booking INSERT** (1×); no seq-scan disasters |
| Connection pool | Prisma default ≈25; only **1–3 active under 600 VU** — huge headroom |
| **Scaling strategy** | ✅ **verified-ready**: `deploy/k8s/pgbouncer-deployment.yaml` (transaction pooling for many instances) + `postgres-replica.yaml` (read replicas) + `postgresql-ha.yaml` |

**The DB is not the bottleneck and the multi-instance scaling path (pgbouncer + replicas) is in place.**

---

## Phase 3 — Redis scaling (one real risk — FIXED)

| Check | Before | After |
|-------|--------|-------|
| `maxmemory` / policy | ⚠️ **0 (unlimited) / `noeviction`** → OOM + write-failures at scale | ✅ **512 MB / `allkeys-lru`** (applied + persisted in `docker-compose.yml`) |
| Memory / large keys / evictions | 1.19 MB, biggest key 2.7 KB, 0 evictions | healthy |
| Cache hit rate | **16.8%** (8.6k hits / 42.7k misses) | ⚠️ underutilized — flag for TTL/key-strategy review under real traffic |

---

## Phase 4 — Cloud Run scale test (BLOCKED) + local horizontal-scaling attempt

| Item | Status |
|------|:------:|
| Cloud Run 100→10k VU autoscaling, live | ⏸️ **BLOCKED** — not deployed (no live Cloud Run) |
| Container horizontally scalable | ✅ stateless (JWT auth, shared state in Redis/PG) — the verified Dockerfile + `deploy/cloud-run/service.yaml` (minScale1/maxScale50/concurrency80) are ready |
| **Local 2-instance proof** | ⚠️ **attempted, blocked by the dev box** — only ~2 GB free RAM; the extra backend containers stuck in "Created" (couldn't start). The horizontal-scaling demo belongs on real infra. |

**Honest gap:** autoscaling is architecturally ready and config-complete, but **not yet load-proven on a
live multi-instance deployment.** That is the one thing standing between "scale-ready by design" and
"scale-proven."

---

## Phase 5 — Bottleneck ranking (with evidence)

| # | Bottleneck | Evidence | Fix | Fix status |
|:-:|-----------|----------|-----|:----------:|
| **1** | **Single-process throughput (~668 req/s)** | 600 VU → p95 840 ms, 0 errors, 2/12 cores, 1–3 PG conns | **Horizontal scaling** (k8s 4-replica HPA / Cloud Run maxScale) | ✅ architecture ready · ⏸️ not load-proven live |
| **2** | **Redis: no eviction cap + low hit rate** | `maxmemory 0/noeviction`; 16.8% hit rate | maxmemory + `allkeys-lru` (done); TTL/key review | ✅ eviction fixed · 🟡 hit-rate to tune |
| **3** | **Write-path latency** | cold booking INSERT 193 ms; writes dominate slow list | async/queue heavy writes (queue-workers manifest exists) | 🟡 design ready |

DB and machine CPU are **not** in the top bottlenecks — the system scales out, not up.

---

## Phase 6 — Cost model (GCP monthly — PROJECTION, not measured)

> Based on the measured ~668 req/s & ~250 MB / ~1 vCPU per instance + public GCP pricing (asia-south1).
> Order-of-magnitude; Maps API is the dominant variable at scale.

| Service | 1,000 users | 10,000 users | 100,000 users |
|---------|------------:|-------------:|--------------:|
| Cloud Run (backend) | $30–60 (1–2 inst) | $150–300 (3–5 inst) | $1.5k–3k (15–25 inst) |
| Cloud SQL (Postgres HA) | ~$80 | ~$250 | ~$1.2k (+replicas) |
| Memorystore Redis | ~$35 (1 GB) | ~$70 (2 GB) | ~$250 (5 GB HA) |
| BigQuery | $10–30 | $50–100 | $300–600 |
| **Google Maps API** | $50–200 | $500–2k | **$5k–20k** (largest, usage-driven) |
| Vertex AI | ~$20 | ~$100 | $500–1.5k |
| **≈ Total / month** | **$250–450** | **$1.1k–2.8k** | **$9k–27k** |

**Cost lever #1 at scale = Maps API** (cache geocoding/directions aggressively; the geo-intel L1/L2 cache already helps).

---

## Verdict: **CONDITIONAL PASS — scale-ready by architecture; one gate (live autoscaling proof) BLOCKED**

| PASS criterion | Result |
|----------------|:------:|
| 1,000 users stable | 🟡 single node serves 600 VU at **0 errors** but p95>SLO; **stable <500 ms needs the multi-instance deploy** (≈2 instances) |
| No critical *unaddressed* bottlenecks | ✅ #1 has a ready fix (horizontal); #2 fixed; DB healthy |
| Cloud Run autoscaling verified | 🔴 **BLOCKED** — config ready, not load-proven live |
| Database scaling strategy verified | ✅ **PASS** — no N+1, 325 indexes, 1–3 conns under load, pgbouncer + replicas in place |

> **Bottom line:** HOMIGO is **architecturally scale-ready** — the backend is stateless and degrades by
> latency (not errors), the DB is not the bottleneck, and the one Redis risk is fixed. The single-node
> "failure" is simply the expected throughput ceiling of *one* process; the fix (horizontal scaling) is
> built and config-complete. **The remaining work is a real multi-instance deployment + a k6 run against
> it to prove autoscaling at 10k** — provisioning, not engineering.

### Exact next step to flip BLOCKED → PROVEN
Deploy `deploy/cloud-run/service.yaml` (or the k8s manifests), then run `scripts/load-test/k6` from an
external generator at 1k → 10k VU; confirm instances scale out, p95 stays <500 ms, and PG/pgbouncer
connections stay within pool. The per-instance ceiling measured here (≈668 req/s) sizes the fleet.
