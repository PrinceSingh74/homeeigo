# PagerDuty + Alertmanager Escalation — Certification (PHASE 3)

**Date:** 2026-06-17
**Config:** `apps/backend/monitoring/alertmanager.yml`, `rules/homigo-enterprise-alerts.yml`
**Verdict:** **BLOCKED (no PagerDuty routing key)** · routing + internal hop **PASS**

---

## 1. Escalation design (in-repo, valid)

P0 escalation ladder defined in Alertmanager routing:
`1min → PagerDuty · 3min → Slack · 5min → WhatsApp · 10min → CTO`
Routing keyed by `priority` label (P0/P1/P2). `homigo-enterprise-alerts.yml` carries the
priority labels per rule.

## 2. EXECUTION EVIDENCE — internal chain proven (real)

`promtool check rules` → **28 rules found**, 0 errors (both rule files valid).

Live incident chain proven by **killing `homigo-redis`**:

```
redis_up == 0  →  RedisDownP1 PENDING (for: 2m)  →  FIRING at t+~100s
            →  Alertmanager received alert: state=active, priority=P1
```

Every internal hop **App → metric → Prometheus → alert rule → Alertmanager** is
execution-verified.

## 3. BLOCKED (honest)

The **PagerDuty delivery hop cannot be executed** — no `PAGERDUTY_ROUTING_KEY` /
integration key exists in this environment. The receiver block is configured and valid;
it will deliver once a routing key is supplied. Per mission rule:
*"If credentials are missing, mark BLOCKED (never fake)."*

**Module score:** Routing + Alertmanager hop **PASS** · PagerDuty delivery **BLOCKED (creds)**
