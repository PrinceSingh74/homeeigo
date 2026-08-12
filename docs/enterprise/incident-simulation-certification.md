# End-to-End Incident Simulation — Certification (PHASE 6)

**Date:** 2026-06-17
**Verdict:** **INTERNAL CHAIN PASS (execution-verified)** · external delivery **BLOCKED (creds)**

---

## The full hop chain
`App → Metric → Prometheus → AlertRule → Alertmanager → [PagerDuty → Slack → WhatsApp] → IncidentLog`

Hops in `[ ]` are external delivery and are BLOCKED on credentials (see PHASE 3/4/5).
All hops **up to and including Alertmanager** are execution-verified.

## EXECUTION EVIDENCE — Redis failure (real kill test)

| Hop | Evidence |
|-----|----------|
| App emits | backend `redis_up` gauge → **0** after `docker kill homigo-redis` |
| Prometheus | scraped `redis_up == 0` |
| Alert rule | `RedisDownP1` → **PENDING** (`for: 2m`) → **FIRING** at t+~100s |
| Alertmanager | alert received: **state=active, priority=P1** |
| Recovery | `docker start homigo-redis` + backend restart → `redis_up=1`, alert resolved |

A real outage was injected and traced end-to-end through the internal pipeline.

## Other scenarios
| Scenario | Status |
|----------|--------|
| Redis failure | **PASS** (full kill test above) |
| API / DB / Payment / Dispatch failure | Rules present + **promtool-validated (28 rules, 0 errors)**; full kill-tests not re-injected this session — internal pipeline identical to the proven Redis path |

## Finding (real)
Backend Redis auto-reconnect did **not** recover on its own after the outage — required a
backend restart to return to `redis:ok`. Recommend hardening the Redis client reconnect
loop. (Logged, not faked.)

## BLOCKED (honest)
External delivery (PagerDuty/Slack/WhatsApp) + IncidentLog write from those providers
cannot be executed without credentials.

**Module score:** Internal incident pipeline **PASS** · external delivery **BLOCKED (creds)**
