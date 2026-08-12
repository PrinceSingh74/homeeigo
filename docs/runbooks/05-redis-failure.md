# Runbook 05 — Redis Failure
**Symptoms:** `[redis]` connection errors, rate-limit/presence degraded.
**Impact:** SINGLE-INSTANCE SAFE — rate limiter, OTP send-gate, tracking presence/throttle all have **in-memory fallback**. Multi-instance loses cross-node presence/fan-out only.
1. Check Upstash/Redis reachability; `REDIS_URL` valid.
2. If down: system keeps working per-process (fallbacks). WS cross-instance fan-out + multi-node rate limits degrade.
3. Restore Redis; no data migration needed (cache only — no source-of-truth in Redis).
4. Verify: presence (`provider:{id}:online`) repopulates on next location ping; rate limits resume cross-node.
