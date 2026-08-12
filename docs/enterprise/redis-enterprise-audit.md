# HOMIGO Redis Enterprise Audit (PHASE 5)

**Date:** 2026-06-18 · **Redis:** 7-alpine (docker) · **Method:** live `redis-cli` (`INFO`,
`--scan`, `TTL`, `TYPE`, `CONFIG GET`) + code cross-check. Every number executed.

## Memory & config (real)
| Metric | Value | Note |
|--------|-------|------|
| used_memory | 1.16 MB (peak 1.47 MB) | tiny — dev workload |
| maxmemory | **0 (unlimited)** | 🟠 see Finding 1 |
| maxmemory-policy | **noeviction** | 🟠 see Finding 1 |
| mem_fragmentation_ratio | 7.61 | ⚪ artifact of <2MB absolute size (allocator overhead); not a real concern at scale |
| persistence (save) | `3600 1 / 300 100 / 60 10000` | RDB snapshotting on |
| connected_clients | 3 | healthy |
| evicted_keys | 0 | — |

## 🟢 Finding — key hygiene is clean (no dead/infinite keys)
Generated live cache activity (services, featured, heatmap, ops-map) then scanned every key:

| Key | TTL | Type |
|-----|-----|------|
| `cache:heatmap:0.05:30:all` | 59s | string |
| `cache:catalog:featured` | 598s | string |
| `cache:catalog:list:1:20:::::` | 57s | string |
| `cache:ops-map:snapshot:0.05` | 5s | string |

**Scanned keys = 4, infinite-TTL keys = 0.** Every cache key is namespaced (`cache:<domain>:…`)
and carries a TTL. **No dead keys, no infinite keys, no oversized payloads, no duplicate
namespaces** observed.

## 🟢 Finding — cache architecture verified in code
`src/services/cache.service.ts`: `getOrFetch(key, ttlSec, fetchFn, l1Sec)` — **two-tier**
(L1 in-process micro-cache + L2 Redis), TTL mandatory per call. No code path writes a cache key
without an expiry.

## 🟢 Finding — distributed locks are safe (NX + EX, auto-releasing)
`src/lib/redis.ts:acquireLock(key, token, ttlSec)` = `SET key token NX EX ttlSec`. Used by:
- **Dispatch lock** — `assignment-engine.service.ts` (`LOCK_TTL_SEC`)
- **Leader election** — `distributed-scheduler.ts` (`ttlSec`)

Every lock has a TTL → **no deadlock / stuck-lock risk** if a holder dies. Token-based release
(check-and-delete) prevents releasing someone else's lock.

## 🟠 Finding 1 (only real gap) — no memory ceiling / eviction safety net
`maxmemory=0` + `maxmemory-policy=noeviction` means that under unexpected memory pressure Redis
will **reject writes** rather than shed cold keys. The TTL discipline above bounds practical
risk, but a production cache should have a safety net.

**Recommendation (hardening):**
```
maxmemory 512mb            # size to instance
maxmemory-policy volatile-lru   # all cache keys have TTLs → evict coldest expiring keys first
```
(`volatile-lru` over `allkeys-lru` so lock keys without short TTLs are never evicted mid-hold.)

## Verdict
**PASS (hygiene) + 1 hardening recommendation.** Cache keys: 100% TTL'd, namespaced, two-tier.
Locks: NX+EX, token-released, no deadlock surface. PubSub/fan-out + presence + leader election
all use the same audited client. Only action: set `maxmemory` + `volatile-lru` eviction policy
as a safety net before production.
