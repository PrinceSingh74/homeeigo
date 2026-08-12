# Evidence — Multi-Node Validation Report

**Generated:** 2026-06-08T17:44:24Z  
**Command:** `REDIS_URL=redis://localhost:6379 bun run p2:cluster`  
**Exit code:** 0  
**Verdict:** ✅ **PASS** (Redis shared-state layer)

> Note: This validates coordination primitives against **one Redis instance** with
> **simulated** 2-node and 3-node lock contention. True 3-process deployment
> (separate OS processes) was **NOT** executed — documented as limitation.

## Results (all PASS)

| Check | Result | Detail |
|---|:--:|---|
| redis_shared_state | ✅ | Redis reachable at localhost:6379 |
| scheduler coordination (5×3 nodes) | ✅ | 5/5 rounds elected exactly one leader |
| 2-node leader election | ✅ | winners=1 (no split-brain) |
| 3-node leader election | ✅ | winners=1 (no split-brain) |
| shared rate limit (2 nodes) | ✅ | allowed=10 of 20 attempts (atomic counter) |
| shared rate limit (3 nodes) | ✅ | allowed=10 of 30 attempts (atomic counter) |
| WebSocket cross-instance fan-out | ✅ | delivered=1; own echo ignored (loop guard) |

## Redis Lock Evidence

- Lock primitive: `SET NX EX` via `redisClient.acquireLock`
- Scheduler: `runWithLeaderLock` in `distributed-scheduler.ts`
- Fan-out channel: `ws:fanout` pub/sub

## Node Logs

Instance ID from fan-out subscriber: `inst_1023affcfdfc` (logged during cluster run).

## 3 Separate Backend Processes — ⚪ NOT VERIFIED

Starting Node 1/2/3 as separate `bun run dev` processes on different ports was not performed. The Redis primitives that enforce single-leader semantics were verified; cross-process isolation remains a staging follow-up.

**Verdict:** ✅ **PASS** (coordination primitives) · ⚪ NOT VERIFIED (3-process deployment)
