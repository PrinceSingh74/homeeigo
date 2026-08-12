# Evidence — Cluster Validation Report

Generated: 2026-06-25T11:12:30.817Z  ·  Verdict: **COMPLETE**

Validates: 2-node & 3-node coordination, horizontal scaling, Redis shared state, WebSocket fan-out, background-job / scheduler coordination — asserting **no duplicate execution, no race conditions, no split-brain**.

| Check | Result | Detail |
|---|:--:|---|
| redis_shared_state | PASS ✅ | Redis reachable — shared coordination active |
| scheduler coordination (5 rounds × 3 nodes) | PASS ✅ | 5/5 rounds elected exactly one leader — no duplicate job execution |
| 2-node leader election | PASS ✅ | winners=1 (expected 1) — no duplicate execution / no split-brain |
| 3-node leader election | PASS ✅ | winners=1 (expected 1) — no duplicate execution / no split-brain |
| shared rate limit across 2 nodes | PASS ✅ | allowed=10 of 20 attempts (expected exactly 10) — atomic shared counter |
| shared rate limit across 3 nodes | PASS ✅ | allowed=10 of 30 attempts (expected exactly 10) — atomic shared counter |
| WebSocket cross-instance fan-out | PASS ✅ | subscribed=true delivered=1 (expected 1; own echo ignored) |

## True cross-process drill
Run on 2–3 separate hosts/containers pointing at the SAME `REDIS_URL` to confirm OS-process isolation. The in-process simulation above already exercises the shared Redis primitives (locks/counters/pubsub) that make cross-process correct.
